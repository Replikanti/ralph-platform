# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ralph is an event-driven AI coding agent platform that receives tasks from Linear webhooks, processes them using Claude AI models (Opus 4.6 for planning and coding, Haiku 4.5 for error summarization), validates the code with polyglot toolchains, and pushes changes to GitHub. Authentication uses Claude Max flat-rate subscriptions via an account pool (no API key required).

**Self-Evolution**: Ralph is an evolving platform. When a task requires adding new capabilities, refactoring the agentic loop, or extending the API, Ralph IS authorized and expected to modify his own source code in `src/`.

## Git Workflow Rules (CRITICAL)

**NEVER push directly to main**. All changes MUST go through Pull Requests, including:
- Code changes
- Documentation updates
- Configuration changes
- Any other modifications

**Branch Naming Convention**:
- Name branches based on the content of changes
- Use prefixes: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`
- Examples:
  - `docs/update-hitl-workflow` - documentation updates
  - `feat/add-pr-iteration` - new feature
  - `fix/auto-execution-prevention` - bug fix
  - `chore/update-dependencies` - maintenance

**Workflow**:
1. Create feature branch from main
2. Make changes and commit
3. Push branch to origin
4. Create PR (can be done manually or via `gh` CLI if needed)
5. Wait for review and approval
6. Merge via GitHub UI

**Runtime**: Bun + TypeScript (Express HTTP, BullMQ queue, Zod validation, Pino logging)

**Source layout**:
```
src/
├── domain/        ← pure business logic, no framework deps (portable to Go)
├── platform/      ← Express + BullMQ orchestration
├── agent/         ← AI execution loop, git workspace, polyglot tools
├── infra/         ← external service wrappers (Linear, Redis, Zod schemas, Pino)
└── security/      ← PII/secret redaction
```

**Key components:**
- **API Server** (src/platform/server.ts): Receives Linear webhooks, validates signatures, enqueues tasks to Redis
- **Worker** (src/platform/worker.ts): Dequeues tasks from Redis, starts BAML proxy, orchestrates agent execution
- **Agent** (src/agent/agent.ts): Core AI workflow - planning (BAML→Claude CLI, Opus 4.6), coding (Claude CLI direct, Opus 4.6), error summarization (BAML→Claude CLI, Haiku 4.5), validation (polyglot tools)
- **Account Pool** (src/infra/account-pool.ts): Manages pool of Claude Max flat-rate accounts; rotates on rate-limit; tracks blocked accounts in Redis
- **BAML** (src/infra/baml/): Typed LLM functions — `PlanTask` and `SummarizeFailure` defined in `.baml` source files, `baml_client/` is generated (gitignored)
- **BAML Proxy** (src/infra/baml-proxy.ts): OpenAI-compatible HTTP proxy (port 3001) that translates BAML requests into `runClaude()` calls — preserves flat-rate Claude Max subscription
- **Claude Runner** (src/infra/claude-runner.ts): `runClaude()` function + `RateLimitError` — spawns Claude CLI subprocess
- **Workspace** (src/agent/workspace.ts): Manages ephemeral Git workspaces in `/tmp/ralph-workspaces`
- **Tools** (src/agent/tools.ts): Polyglot validation (Biome, TSC, Ruff, Mypy, goimports, staticcheck, go build, terraform, tflint, Trivy)
- **Plan Store** (src/infra/plan-store.ts): Redis-based persistence for human-in-the-loop plan reviews
- **Linear Client** (src/infra/linear-client.ts): Integration for posting plans and updating issue states
- **Linear Utils** (src/infra/linear-utils.ts): Shared utilities including state synonym mapping
- **Webhook Schemas** (src/infra/webhook-schemas.ts): Zod schemas parsing raw Linear payloads into domain types
- **Logger** (src/infra/logger.ts): Pino structured logging singleton (JSON in prod, pretty in dev)
- **Domain** (src/domain/): Pure business logic — webhook routing decisions, agent outcome mapping, shared types

## Architecture Flow

### Default Mode (Human-in-the-Loop Planning - ENABLED by default)

1. Linear webhook → API validates signature → enqueues to Redis
2. Worker dequeues → clones repo to ephemeral workspace
3. Agent runs **plan-only mode** (Opus 4.6 generates implementation plan)
4. Plan posted to Linear as comment, issue moved to **"Todo"** state (awaiting approval)
5. **Human reviews plan**:
   - Comment "LGTM", "approved", "proceed", or "ship it" → Ticket moves to "In Progress" → Execution job queued
   - Comment with feedback → Ticket moves to "In Progress" → Re-planning job queued with feedback context
   - **Ralph's own comments are filtered to prevent auto-execution**
6. On approval: Agent runs **execute-only mode** (Opus 4.6 implements approved plan)
7. Polyglot validation runs on generated code
8. Push to GitHub (creates PR branch)
9. Wait 3 seconds for Linear auto-switch to "In Review" (only manual update if needed)
10. Langfuse trace captures entire execution

### Legacy Mode (PLAN_REVIEW_ENABLED=false)

1. Linear webhook → API validates signature → enqueues to Redis
2. Worker dequeues → clones repo to ephemeral workspace
3. Agent runs **full mode** (plan + execute in one go):
   - Planning phase (Claude Opus 4.6)
   - Execution phase (Claude Opus 4.6)
4. Polyglot validation runs on generated code
5. Push to GitHub (creates PR branch)
6. Langfuse trace captures entire execution

## Human-in-the-Loop Planning

Ralph supports **human-in-the-loop** plan review, allowing developers to approve or iterate on implementation plans before code execution begins. This feature is **enabled by default** and helps ensure Ralph's approach aligns with team expectations.

### How It Works

**1. Plan Generation**
- When a Linear issue with the "Ralph" label is created/updated, Ralph generates an implementation plan using Claude Opus 4.6
- The plan is posted as a comment on the Linear issue
- The issue is automatically moved to the **"Todo"** state (awaiting human approval)

**2. Plan Review**
Developers review the posted plan and can:
- **Approve**: Comment with approval phrases (`LGTM`, `approved`, `proceed`, `ship it`)
  - API filters Ralph's own comments to prevent auto-execution
  - Issue moves to "In Progress" state
  - Triggers execution job with the approved plan
  - Ralph executes the plan using Claude Opus 4.6
- **Request Changes**: Comment with specific feedback
  - Issue moves to "In Progress" state
  - Triggers re-planning job with feedback incorporated
  - Ralph generates revised plan with feedback context
  - Issue moves back to "Todo" after revised plan is posted

**3. State Transitions**
```
Todo → In Progress (planning) → Todo (awaiting approval)
         ↑_________________________↓ (user comments)
         In Progress (executing) → In Review (PR created) → Done
```

**4. PR Creation Race Condition Prevention**
- Ralph creates PR **before** updating Linear state
- Waits 3 seconds for Linear's automatic state switch to "In Review"
- Only manually updates state if Linear didn't auto-switch
- This prevents tickets from ending up in the wrong state

### Configuration

**Environment Variables:**
- `PLAN_REVIEW_ENABLED` - Enable/disable plan review (default: `true`)
- `PLAN_TTL_DAYS` - Redis TTL for stored plans in days (default: `7`)
- `LINEAR_API_KEY` - Required for posting comments and updating states (needs write access)

**Disabling Plan Review:**
Set `PLAN_REVIEW_ENABLED=false` to revert to legacy behavior (plan + execute in one job).

### Approval Commands

Ralph recognizes these case-insensitive patterns as approval:
- `lgtm`
- `approved`
- `proceed`
- `ship it`

Any other comment content is treated as revision feedback.

### Plan Storage

Plans are stored in Redis with the key pattern `ralph:plan:{issueId}` and include:
- Implementation plan (Opus 4.6 output)
- Original task context (title, description, repo, branch)
- Feedback history (accumulated revision requests)
- Status (`pending-review`, `approved`, `needs-revision`)
- TTL (7 days by default)

Plans are automatically deleted after successful execution or TTL expiration.

### Setup Requirements for Plan Review

To use human-in-the-loop planning, you must:
1. Set `LINEAR_API_KEY` in your environment (requires write access)
2. Use standard Linear states: "Todo", "In Progress", "In Review", "Done"

Ralph uses the "Todo" state for awaiting plan approval. When you comment, the ticket automatically moves back to "In Progress".

**State Synonym Mapping** (src/infra/linear-utils.ts):
- "in progress": in progress, wip, doing
- "in review": under review, peer review, review, pr
- "todo": todo, triage, backlog, unstarted, ready
- "done": done, completed, closed

This allows flexibility in Linear workspace naming conventions.

## Claude Code Commands (Skills)

Ralph includes custom Claude Code commands in `.claude/commands/` for efficient codebase navigation:

- **/ralph-platform** - Project-specific instructions and context
- **/project-map** - Generate token-optimized project structure (uses tree-toon.js)
- **/trace-deps** - Trace dependencies for a file (uses trace-deps.js)
- **/test-filter** - Filter tests by pattern (uses test-filter.js)

These commands invoke helper scripts in `.claude/scripts/` that output TOON format for reduced token usage.

## Development Commands

### Build
```bash
bun run build
```
Bundles `src/platform/server.ts`, `src/platform/worker.ts`, and `src/infra/mcp-toonify.ts` into `dist/` using Bun's native bundler targeting Node.

### Testing
```bash
# Run all tests
npm test
# (internally: bun test with separate invocations per test group to avoid mock isolation issues)

# Run a specific test file
bun test tests/server.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "webhook signature"

# Watch mode
bun test --watch
```

**Note**: Some test files must run in separate `bun test` invocations because Bun runs all files in the same process — conflicting module mocks from different files can leak into each other.

### Local Development
```bash
# Start entire stack (Redis + API + Worker)
docker-compose up --build

# Start individual services
bun run src/platform/server.ts    # API on port 3000
bun run src/platform/worker.ts    # Background worker
```

### Environment Setup
Copy `.env.example` to `.env` and configure:
- `REDIS_URL`: Redis connection (default: redis://localhost:6379)
- `GITHUB_TOKEN`: Requires 'repo' scope for cloning and pushing
- `CLAUDE_ACCOUNTS_DIR`: Directory containing Claude Max account subdirectories (default: `/claude-accounts`)
- `CLAUDE_RATE_LIMIT_TTL_MINUTES`: Fallback TTL (minutes) for rate-limited accounts (default: `60`)
- `LINEAR_WEBHOOK_SECRET`: HMAC secret from Linear webhook settings
- `LINEAR_API_KEY`: API key for posting comments and updating issue states (required for plan review)
- `PLAN_REVIEW_ENABLED`: Enable human-in-the-loop planning (default: true)
- `PLAN_TTL_DAYS`: Redis TTL for stored plans in days (default: 7)
- `LOG_LEVEL`: Pino log level — `debug | info | warn | error` (default: info)
- `WORKSPACE_ROOT`: Override workspace directory (default: /tmp/ralph-workspaces)
- `LANGFUSE_*`: Optional tracing (cloud.langfuse.com)
- `BAML_PROXY_PORT`: Port for the BAML proxy server (default: 3001)
- `BAML_PROXY_URL`: URL that BAML clients use to reach the proxy (default: `http://localhost:3001/v1`, set automatically by worker.ts)

## Critical Implementation Details

### BAML Integration

Ralph uses BAML (Boundary AI Markup Language) for structured LLM interactions in plan and summarize phases. The flow:

```
agent.ts calls b.PlanTask() or b.SummarizeFailure()
  → BAML client sends OpenAI-compatible request to BAML_PROXY_URL
  → baml-proxy.ts receives request, extracts prompt, calls runClaude()
  → Claude CLI executes and returns text
  → baml-proxy.ts wraps response in OpenAI format
  → BAML parses response into typed TypeScript struct
```

**BAML source files** (`.baml`) are in `src/infra/baml/baml_src/` and are git-tracked.
**Generated client** (`baml_client/`) is gitignored. Regenerate with:
```bash
node_modules/.bin/baml-cli generate --from src/infra/baml/baml_src
```
The build script runs this automatically before bundling.

**Important**: The BAML proxy does NOT apply PII redaction — it's a simple pass-through to Claude CLI. The execute phase (`runClaude()` direct) also has no PII redaction. PII redaction is only applied at the Linear webhook ingestion layer if configured.

**`b` is lazily imported** in `agent.ts` functions to avoid loading the native BAML runtime at module load time (causes Bun test runner issues — see testing section).



### Linear Webhook Security
The webhook endpoint (src/platform/server.ts) uses **HMAC SHA-256 signature verification** with timing-safe comparison. The raw request body is captured via express middleware and verified against the `linear-signature` header using `LINEAR_WEBHOOK_SECRET`.

**Never bypass signature verification** - it prevents unauthorized job injection.

### Task Filtering
Only Linear issues with the label "Ralph" (case-insensitive) trigger agent execution.

**Issue Webhooks** (create/update):
- Ignored if issue lacks "Ralph" label
- Ignored if already in terminal states (In Progress, In Review, Completed, Done, Canceled)
- Enqueues plan-only job (or full job if PLAN_REVIEW_ENABLED=false)

**Comment Webhooks** (create):
- **Ralph's own comments are filtered** to prevent auto-execution loops
- Comments with stored plans trigger approval/feedback flow
- Comments on issues in "In Review" state without stored plan trigger PR iteration
- Approval comments trigger execute-only job (moves ticket to "In Progress")
- Feedback comments trigger re-planning job with accumulated feedback
- Requires stored plan in Redis (7-day TTL)

### Workspace Isolation
Each job gets a UUID-based ephemeral workspace under `WORKSPACE_ROOT` (default `/tmp/ralph-workspaces`). The workspace module (src/agent/workspace.ts) clones the repo using OAuth token authentication, creates/checks out a feature branch (`ralph/feat-{identifier}`), and configures git identity as "Ralph Bot <ralph@duvo.ai>".

**Always call `cleanup()` after job completion** to prevent disk exhaustion.

### Agent Execution Modes
The agent (src/agent/agent.ts) supports three execution modes controlled by `task.mode`:
1. **plan-only**: Opus 4.6 generates implementation plan, posts to Linear, stores in Redis (default when PLAN_REVIEW_ENABLED=true)
2. **execute-only**: Opus 4.6 executes pre-approved plan from Redis (triggered by approval comment)
3. **full**: Legacy mode - Opus 4.6 plans then executes in one job (default when PLAN_REVIEW_ENABLED=false)

Mode is set by the webhook handler based on webhook type (issue vs comment) and plan review configuration.

### Claude Max Account Pool

Ralph uses Claude Max flat-rate subscriptions instead of API keys. The account pool (`src/infra/account-pool.ts`) manages multiple accounts and rotates on rate-limit.

**Directory structure** (`CLAUDE_ACCOUNTS_DIR`, default `/claude-accounts`):
```
/claude-accounts/
  account-0/
    .credentials.json    ← from `claude login`
    settings.json        ← optional
  account-1/
    .credentials.json
```

**Rate-limit tracking**: Blocked accounts are stored in Redis as `ralph:account:ratelimited:{id}` with TTL from CLI retry-after (or `CLAUDE_RATE_LIMIT_TTL_MINUTES`, default 60min).

**Rotation flow** (worker.ts):
1. RateLimitError caught → current account marked blocked in Redis
2. If another account is available → job retried immediately with next account
3. If all accounts blocked → job delayed by `retryAfterMs` (or 60s)

**Credential seeding**: Both BAML proxy and execute phase seed credentials into temp HOME dirs (`/tmp/baml-proxy-*/` and workspace `home/`). The `readOnlyRootFilesystem: true` K8s constraint is handled — accounts are read from Secret volumes, seeded into emptyDir `/tmp`.

### Agent Security Layer
The agent has a two-tier prompt system:
1. **SECURITY_GUARDRAILS**: Immutable security rules preventing secret exposure, destructive operations, and sandbox escapes
2. **Repo Skills**: Mutable per-repo instructions loaded from `.ralph/skills/*.md` in the target repository

When adding features, preserve this separation - security rules are hardcoded, repo-specific guidance comes from the skills directory.

#### Agent Tool Execution Security
The agent uses the native Claude CLI (Claude Code) tools for code manipulation. The following tools are available to the agent:
- `Bash`: Execute shell commands (within allowlist)
- `Read`: Read file contents
- `Edit`: Apply precise edits to files
- `FileSearch`: Search for text across the codebase
- `Glob`: Find files matching patterns
- `LS`: List directory contents

**Command Execution Security (src/agent/tools.ts)**:
The `runCommand` tool implements defense-in-depth against command injection:

1. **Allowlist Validation**: Only whitelisted command patterns are permitted:
   - Build tools: `npm test`, `npm run build`, `npx`, `node`
   - Version control: `git status`, `git log`, `git diff`, `git show`
   - File operations: `ls`, `cat`, `pwd`, `echo`
   - Testing: `pytest`, `python -m pytest`
   - Linters: `ruff`, `mypy`, `staticcheck`, `tflint`
   - Go tools: `go build`, `go test`, `go mod`, `go vet`, `go run`, `go fmt`, `gofmt`, `goimports`
   - Terraform tools: `terraform init`, `terraform fmt`, `terraform validate`, `terraform plan`

2. **Dangerous Pattern Blocking**: Commands containing these patterns are rejected:
   - Shell metacharacters: `;`, `&`, `|`, `` ` ``, `$()`, `$()`
   - Destructive operations: `rm -rf`
   - Device manipulation: `> /dev/`
   - Piped downloads: `curl ... |`, `wget ... |`

3. **Resource Limits**:
   - Timeout: 60 seconds maximum execution time
   - Buffer limit: 1MB maximum output size
   - Output sanitization: Truncated to 5000 chars (stdout) / 2000 chars (stderr)

4. **Path Traversal Protection**: All file operations validate that resolved paths remain within `workDir` using `path.resolve()` + `startsWith()` checks.

**Critical**: Never bypass these security controls. The agent operates on untrusted repositories and must not execute arbitrary commands or access files outside the workspace.

### Polyglot Validation
The tools module (src/agent/tools.ts) auto-detects project type and runs:
- **TypeScript/JavaScript**: Biome (formatting/linting with auto-fix) + TSC (type checking)
- **Python**: Ruff (linting + formatting with auto-fix) + Mypy (type checking with `--ignore-missing-imports`)
- **Go**: goimports (formatting/imports with auto-fix) + staticcheck (linting - MIT licensed) + go build (compilation check)
- **Terraform**: terraform fmt (formatting with auto-fix) + terraform validate (syntax validation) + tflint (linting with partial auto-fix)
- **Security**: Trivy (vulnerability, secret, and misconfiguration scanning - supports Go, Python, JS/TS, Terraform)

Validation failures are captured in the output and provided as feedback to the agent for fixing in the next iteration.

### BullMQ Configuration
Worker (src/platform/worker.ts):
- Concurrency: 1 parallel job per worker pod
- Rate limiter: 10 jobs per 60 seconds
- Retry strategy: 3 attempts with exponential backoff (2s base delay)
- Job retention: All jobs (completed and failed) auto-removed immediately to allow re-runs
- **RateLimitError handling**: marks current account as blocked → rotates to next available account (immediate retry) → if all blocked, delays by `retryAfterMs` or 60s

### Langfuse Tracing
All agent executions are traced hierarchically:
- Top-level trace: "Ralph-Task" with ticketId
- Spans: "Planning-Opus-*" (Opus 4.6), "Execution-Opus-*" (Opus 4.6), "Error Summary" (Haiku 4.5), "Validation" (polyglot)
- Errors automatically captured in trace metadata

### Token Optimization (TOON)
To save context window space, prefer **TOON (Token Optimized Object Notation)** over JSON for large structured outputs (like file lists or search results) when communicating internally:
- Use `key:value` without quotes.
- Lists as `item1,item2,item3`.
- Indentation for nesting, avoid `{}` and `[]`.
- Example:
  ```text
  files:
    src/agent.ts
    src/server.ts
  status:active
  ```

**MCP Toonify**: The `src/infra/mcp-toonify.ts` module converts Model Context Protocol (MCP) tool schemas from JSON to TOON format, reducing token usage when passing tool definitions to Claude.

## Testing Strategy

Tests use supertest for API endpoints and mock all external dependencies (Redis, Langfuse, simple-git, child_process, BAML). See `tests/` for patterns.

### Bun Test Patterns (CRITICAL)

- `bun test` runs files in the **same process** — module mocks leak between files. Run conflicting files as separate `bun test` invocations (see `package.json` test script).
- `mock.module()` is hoisted before static imports within a file.
- **Preload file** (`tests/setup.ts`): mocks that must be in place before ANY module loads go here (ioredis, bullmq, bull-board, **langfuse**). The Langfuse SDK opens timers/connections at module load time that prevent tests from completing.
- **BAML in tests**: `b` is lazily imported in `agent.ts` (dynamic import inside functions). Mock `'../src/infra/baml'` in the test file:
  ```typescript
  const mockPlanTask = mock();
  const mockSummarizeFailure = mock();
  mock.module('../src/infra/baml', () => ({
      b: { PlanTask: mockPlanTask, SummarizeFailure: mockSummarizeFailure },
  }));
  // In beforeEach:
  mockPlanTask.mockResolvedValue({ plan: 'Do X' });
  mockSummarizeFailure.mockResolvedValue({ summary: 'Failed.' });
  ```
  **Do NOT** use a static `import { b } from '../src/infra/baml'` in agent.ts — this loads the native baml_client at module import time (Bun loads baml_client code even when the directory module is mocked).
- `jest.fn()` INSIDE mock factory closures fails (jest not available at hoist time). Declare mock instances as top-level `const` BEFORE the factory.
- `expect.any(MockConstructor)` fails — use `expect.anything()` instead.
- `.resolves.not.toThrow()` doesn't work in Bun — use plain `await promise`.

### Test Organization
- `tests/fixtures/` - Shared test data (webhook payloads, mocks)
- `tests/fixtures/mocks.ts` - Reusable mock factories for Redis, Anthropic, etc.
- `tests/fixtures/webhook-payloads.ts` - Linear webhook payload samples

Key test files:
- `tests/server.test.ts`: Webhook signature verification, filtering logic, comment handling
- `tests/worker.test.ts`: Job processing, retry behavior, error handling, mode switching
- `tests/agent.test.ts`: Skill loading, LLM orchestration, tracing, plan-only/execute-only modes
- `tests/workspace.test.ts`: Git operations, cleanup
- `tests/tools.test.ts`: Polyglot validation detection
- `tests/plan-store.test.ts`: Redis plan persistence, TTL, feedback accumulation
- `tests/linear-client.test.ts`: Linear API integration, state updates
- `tests/plan-formatter.test.ts`: Plan markdown formatting

## Production Deployment

The platform is designed for GKE deployment (see `helm/` directory). The docker-compose setup is for local development only.

**Important**:
- Worker pods need write access to `/tmp/ralph-workspaces` volume (mounted in docker-compose.yaml:32-33)
- Persistent volume for `/app/claude-cache` recommended to reduce API costs (see helm/ralph/templates/pvc.yaml)
- External Secrets Operator automatically syncs secrets from GCP Secret Manager (see README.md Phase 3)

### Multi-Repository Support

Ralph maps Linear teams to GitHub repositories via Helm chart configuration (`teamRepos` in `values.yaml`). The mapping is deployed as a Kubernetes ConfigMap and cached in Redis for fast lookups.

**Configuration** (`helm/ralph/values.yaml`):
```yaml
teamRepos:
  FRONTEND: "https://github.com/org/frontend"
  BACKEND: "https://github.com/org/backend"
```

**How it works**:
1. Helm renders ConfigMap from `values.yaml`
2. Mounted at `/etc/ralph/config/repos.json` in pods
3. Ralph reads file, caches in Redis
4. Auto-reloads on file mtime change (no restart needed)

**Fallback**: `DEFAULT_REPO_URL` for unmapped teams.

See **[DEPLOYMENT.md](./DEPLOYMENT.md#multi-repository-setup)** for detailed setup instructions.
