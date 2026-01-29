# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ralph is an event-driven AI coding agent platform that receives tasks from Linear webhooks, processes them using Claude AI models (Opus for planning, Sonnet for coding), validates the code with polyglot toolchains, and pushes changes to GitHub.

**Self-Evolution**: Ralph is an evolving platform. When a task requires adding new capabilities, refactoring the agentic loop, or extending the API, Ralph IS authorized and expected to modify his own source code in `src/`.

**Key components:**
- **API Server** (src/server.ts): Receives Linear webhooks, validates signatures, enqueues tasks to Redis
- **Worker** (src/worker.ts): Dequeues tasks from Redis, orchestrates agent execution
- **Agent** (src/agent.ts): Core AI workflow - planning (Opus), coding (Sonnet), validation (polyglot tools)
- **Workspace** (src/workspace.ts): Manages ephemeral Git workspaces in `/tmp/ralph-workspaces`
- **Tools** (src/tools.ts): Polyglot validation (Biome, TSC, Ruff, Mypy, Semgrep)

## Architecture Flow

1. Linear webhook → API validates signature → enqueues to Redis
2. Worker dequeues → clones repo to ephemeral workspace
3. Agent runs two-phase LLM workflow:
   - Planning phase (Claude Opus)
   - Execution phase (Claude Sonnet)
4. Polyglot validation runs on generated code
5. Push to GitHub (creates PR branch)
6. Langfuse trace captures entire execution

## Development Commands

### Build
```bash
npm run build
```
Compiles TypeScript from `src/` to `dist/` using CommonJS target ES2022.

### Testing
```bash
# Run all tests with coverage
npm test

# Run specific test file
NODE_OPTIONS=--experimental-vm-modules npx jest tests/server.test.ts

# Watch mode
NODE_OPTIONS=--experimental-vm-modules npx jest --watch
```

### Local Development
```bash
# Start entire stack (Redis + API + Worker)
docker-compose up --build

# Start individual services (after building)
npm run start:api      # Runs on port 3000
npm run start:worker   # Processes jobs from Redis
```

### Environment Setup
Copy `.env.example` to `.env` and configure:
- `REDIS_URL`: Redis connection (default: redis://localhost:6379)
- `GITHUB_TOKEN`: Requires 'repo' scope for cloning and pushing
- `ANTHROPIC_API_KEY`: For Claude API access
- `LINEAR_WEBHOOK_SECRET`: HMAC secret from Linear webhook settings
- `LANGFUSE_*`: Optional tracing (cloud.langfuse.com)

## Critical Implementation Details

### Linear Webhook Security
The webhook endpoint (src/server.ts:49) uses **HMAC SHA-256 signature verification** with timing-safe comparison. The raw request body is captured via express middleware (line 11-14) and verified against the `linear-signature` header using `LINEAR_WEBHOOK_SECRET`.

**Never bypass signature verification** - it prevents unauthorized job injection.

### Task Filtering
Only Linear issues with the label "Ralph" (case-insensitive) trigger agent execution (src/server.ts:57-58).

### Workspace Isolation
Each job gets a UUID-based ephemeral workspace in `/tmp/ralph-workspaces`. The workspace module (src/workspace.ts) clones the repo using OAuth token authentication, creates/checks out a feature branch (`ralph/feat-{identifier}`), and configures git identity as "Ralph Bot <ralph@duvo.ai>".

**Always call `cleanup()` after job completion** to prevent disk exhaustion.

### Agent Security Layer
The agent (src/agent.ts:12-18) has a two-tier prompt system:
1. **SECURITY_GUARDRAILS**: Immutable security rules preventing secret exposure, destructive operations, and sandbox escapes
2. **Repo Skills**: Mutable per-repo instructions loaded from `.ralph/skills/*.md` in the target repository

When adding features, preserve this separation - security rules are hardcoded, repo-specific guidance comes from the skills directory.

#### Agent Tool Execution Security
The agent uses native Claude tool use for code manipulation (src/tools.ts). Four tools are exposed:
- `list_files`: Directory listing with path traversal protection
- `read_file`: File reading with path traversal protection
- `write_file`: File writing with path traversal protection
- `run_command`: Shell command execution with **strict security controls**

**Command Execution Security (src/tools.ts:34-89)**:
The `runCommand` tool implements defense-in-depth against command injection:

1. **Allowlist Validation**: Only whitelisted command patterns are permitted:
   - Build tools: `npm test`, `npm run build`, `npx`, `node`
   - Version control: `git status`, `git log`, `git diff`, `git show`
   - File operations: `ls`, `cat`, `pwd`, `echo`
   - Testing: `pytest`, `python -m pytest`
   - Linters: `ruff`, `mypy`

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
The tools module (src/tools.ts) auto-detects project type and runs:
- **TypeScript/JavaScript**: Biome (formatting/linting with auto-fix) + TSC (type checking)
- **Python**: Ruff (linting + formatting with auto-fix) + Mypy (type checking with `--ignore-missing-imports`)
- **Security**: Semgrep with auto config (runs on all projects)

Validation failures still result in a push (with "wip:" prefix) to preserve work.

### BullMQ Configuration
Worker (src/worker.ts:26-30):
- Concurrency: 2 parallel jobs per worker pod
- Rate limiter: 5 jobs per 60 seconds (Anthropic API protection)
- Retry strategy: 3 attempts with exponential backoff (2s base delay)
- Job retention: Completed jobs auto-removed, failed jobs kept for inspection

### Langfuse Tracing
All agent executions are traced hierarchically:
- Top-level trace: "Ralph-Task" with ticketId
- Spans: "Planning" (Opus), "Coding" (Sonnet), "Validation" (polyglot)
- Errors automatically captured in trace metadata

## Testing Strategy

Tests use supertest for API endpoints and mock all external dependencies (Redis, Anthropic SDK, Langfuse, simple-git, child_process). See `tests/` for patterns.

Key test files:
- `tests/server.test.ts`: Webhook signature verification, filtering logic
- `tests/worker.test.ts`: Job processing, retry behavior, error handling
- `tests/agent.test.ts`: Skill loading, LLM orchestration, tracing
- `tests/workspace.test.ts`: Git operations, cleanup
- `tests/tools.test.ts`: Polyglot validation detection

## Production Deployment

The platform is designed for GKE deployment (see `helm/` directory). The docker-compose setup is for local development only.

**Important**: Worker pods need write access to `/tmp/ralph-workspaces` volume (mounted in docker-compose.yaml:32-33).
