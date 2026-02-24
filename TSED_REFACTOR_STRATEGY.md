# Ts.ED Refactoring Strategy: Ralph to The Factory

**Objective:** Transform the existing Express/Node.js MVP ("Ralph") into a highly structured, scalable, and maintainable Enterprise Platform ("The Factory") using the **Ts.ED (TypeScript Easy Definition)** framework.

**Target Audience:** Claude Sonnet 4.5 (Implementation Executor), reviewed by Claude Opus 4.6 (Architecture Reviewer).

---

## 1. Architectural Philosophy & Constraints

The goal is not just to wrap Express routes in decorators, but to adopt **Inversion of Control (IoC)**, **Dependency Injection (DI)**, and **Domain-Driven Design (DDD)** principles native to Ts.ED.

*   **Constraint 1: Preserve Core Logic.** The cognitive loop (Claude CLI spawning in `agent.ts`), file operations (`workspace.ts`), polyglot validation (`tools.ts`), PII redaction (`security/redactor.ts`), plan formatting (`plan-formatter.ts`), and Linear state mapping (`linear-utils.ts`) are considered **Domain Services**. Their internal logic remains unchanged; only their instantiation and integration into the platform change.
*   **Constraint 2: No Global State.** Eliminate all global variables and standalone Redis/BullMQ connections (e.g., `const connection = new IORedis(...)` in `server.ts`, duplicated in `worker.ts`). All external resources must be managed via Ts.ED Providers/Services.
*   **Constraint 3: Type Safety at the Boundaries.** Replace manual `req.body` parsing and validation with Ts.ED **DTOs (Data Transfer Objects)** using `@Property()`, `@Required()`, and `@Enum()` decorators to generate automatic Swagger/OpenAPI documentation and runtime validation.
*   **Constraint 4: Testability First.** The new architecture must allow for trivial unit testing of Controllers and Services by utilizing Ts.ED's DI container for mocking, eliminating the need for complex `jest.mock()` setups.
*   **Constraint 5: Preserve Agent Execution Model.** Ralph's agent does NOT call the Anthropic API directly. It spawns the **Claude CLI binary** (`/usr/local/bin/claude`) as a child process with isolated HOME directory, cache seeding, and credential management. This must be preserved exactly.

---

## 2. Current Architecture Reality (Critical Context)

Before refactoring, the executor must understand what actually exists:

### Agent Execution Model (agent.ts)
- Agent spawns `claude` CLI binary via `child_process.spawn()` - NOT direct Anthropic SDK calls
- Each job gets an isolated HOME directory (`{rootDir}/home/`) with:
  - Claude credentials (`.credentials.json`, `settings.json`)
  - MCP toonify server config
  - Claude Code commands copied from target repo's `.claude/commands/`
- Cache is seeded from persistent volume (`/app/claude-cache`) and persisted back after each iteration
- Three modes: `plan-only` (Sonnet $0.50), `execute-only` (Sonnet $2.00), `full` (legacy)

### Worker Configuration (worker.ts - actual values)
- `concurrency: 1` (single job per worker pod)
- `limiter: { max: 10, duration: 60000 }` (10 jobs per minute)
- `lockDuration: 600000` (10 minutes - for long LLM tasks)
- `lockRenewTime: 30000` (renew every 30s)
- **Tombstone mechanism**: On execution completion, sets `ralph:tombstone:{ticketId}` in Redis (1 year TTL) to prevent re-processing

### Idempotency (server.ts - job ID patterns)
- Issue webhook: `jobId = data.id`
- Plan approval: `jobId = {issueId}-exec`
- Plan revision: `jobId = {issueId}-replan`
- PR iteration: `jobId = {issueId}-iterate`
- All jobs use `removeOnComplete: true, removeOnFail: true`

### Files NOT in Main Build
- `src/mcp-toonify.ts` is **excluded from tsconfig.json** (uses ESM top-level `await`). It runs as a standalone MCP server process. Do not include it in the Ts.ED build.

### Legacy Tool Definitions
- The `agentTools` array in `tools.ts` (Anthropic SDK tool definitions) is **legacy dead code** - the agent now uses Claude CLI native tools (`--tools 'Bash,Read,Edit,FileSearch,Glob'`). These can be removed during migration.

---

## 3. Target Directory Structure

```text
src/
├── Server.ts                 # Ts.ED Server bootstrap and global configuration
├── index.ts                  # Entry point: import "reflect-metadata" + PlatformExpress.bootstrap(Server)
├── config/
│   └── env.ts                # Centralized environment variable validation and typing
├── controllers/
│   ├── WebhookController.ts  # Linear webhook ingress. Routes to services. Zero business logic.
│   └── SystemController.ts   # Health checks (/health) and BullBoard admin dashboard.
├── models/
│   ├── payloads/
│   │   ├── IssueWebhookPayload.ts
│   │   └── CommentWebhookPayload.ts
│   └── enums/
│       └── WebhookAction.ts
├── middlewares/
│   └── SignatureVerificationMiddleware.ts  # HMAC SHA-256 verification of Linear webhooks
├── services/
│   ├── RedisProvider.ts       # Shared IORedis connection with @OnInit/@OnDestroy lifecycle
│   ├── QueueService.ts        # BullMQ Queue: enqueueExecution, enqueueReplanning, enqueueIteration
│   ├── WorkerService.ts       # BullMQ Worker lifecycle: @OnInit creates worker, @OnDestroy graceful shutdown
│   ├── ConfigService.ts       # Team→repo mapping (ConfigMap file + Redis cache + mtime invalidation)
│   ├── PlanStoreService.ts    # Redis plan persistence (store, get, update, delete, appendFeedback)
│   ├── LinearClientService.ts # Linear SDK wrapper (postComment, updateIssueState, getIssueState)
│   ├── GitHubService.ts       # Octokit wrapper (createPullRequest, generatePRDescription)
│   ├── LangfuseService.ts     # Langfuse trace lifecycle management
│   └── AgentOrchestratorService.ts  # Core: Claude CLI spawning, plan/execute modes, validation loop
├── domain/                    # Pure logic (NO Ts.ED decorators, NO DI). Functional modules.
│   ├── WorkspaceManager.ts    # Formerly workspace.ts - ephemeral git workspace setup/cleanup
│   ├── AgentTools.ts          # Formerly tools.ts - polyglot validation, command security
│   ├── PiiRedactor.ts         # Formerly security/redactor.ts - secret/PII redaction
│   ├── PlanFormatter.ts       # Formerly plan-formatter.ts - plan markdown formatting
│   └── LinearUtils.ts         # Formerly linear-utils.ts - state synonym mapping
├── security/
│   └── redactor.ts            # KEPT during migration as alias, removed in cleanup phase
└── mcp-toonify.ts             # UNCHANGED - standalone ESM MCP server (excluded from tsconfig)
```

---

## 4. Execution Plan (Phase-by-Phase for Sonnet 4.5)

Each phase has a corresponding set of task files (`tasks/XXX_*.md`) with detailed implementation instructions.

### Phase 0: Foundation & Bootstrapping
**Goal:** Establish DI container, TypeScript decorator support, and basic server structure.
**Tasks:** 001-005

1.  **Dependencies (001):** Install `@tsed/common`, `@tsed/core`, `@tsed/di`, `@tsed/exceptions`, `@tsed/platform-express`, `@tsed/swagger`, `@tsed/logger`, `reflect-metadata`.
2.  **TypeScript Config (001):** Add `"experimentalDecorators": true`, `"emitDecoratorMetadata": true` to tsconfig.json.
3.  **Directory Structure (002):** Create all directories from section 3.
4.  **Environment Config (003):** Centralized `config/env.ts` replacing scattered `process.env` reads.
5.  **Redis Provider (004):** `services/RedisProvider.ts` with `@OnInit()` / `@OnDestroy()` lifecycle.
6.  **Server Bootstrap (005):** `Server.ts` + `index.ts` entry point with Helmet, Morgan, raw body capture.

**Critical Detail:** The raw body capture for HMAC verification must happen BEFORE Ts.ED's body parser. Configure it in `Server.ts` via `$beforeRoutesInit()` hook using Express middleware.

### Phase 1: Domain Layer Migration
**Goal:** Move pure logic files to `domain/` with minimal changes. NO Ts.ED decorators in this layer.
**Tasks:** 006-007

1.  **Core Domain (006):** Move `workspace.ts`, `security/redactor.ts`, `plan-formatter.ts`, `linear-utils.ts` to `domain/`.
2.  **Agent Tools (007):** Move `tools.ts` to `domain/AgentTools.ts`. Remove legacy `agentTools` array (dead code). Keep `runPolyglotValidation`, `detectProjectLanguages`, `runCommand`, and file operation functions.

### Phase 2: DTO & Middleware Layer
**Goal:** Create typed request models and signature verification middleware.
**Tasks:** 008-009

1.  **DTOs (008):** Create `IssueWebhookPayload.ts`, `CommentWebhookPayload.ts` with Ts.ED decorators based on actual Linear webhook payloads (see `tests/fixtures/webhook-payloads.ts` for structure).
2.  **Signature Middleware (009):** Extract `verifyLinearSignature` into `@Middleware()` class. Must read from `req.rawBody` buffer. Throw `Unauthorized` on failure.

### Phase 3: Infrastructure Services
**Goal:** Wrap all external integrations in injectable services.
**Tasks:** 010-014

1.  **ConfigService (010):** Team→repo mapping with file + Redis cache + mtime invalidation.
2.  **PlanStoreService (011):** Wrap plan-store.ts functions. Inject RedisProvider.
3.  **LinearClientService (012):** Wrap linear-client.ts. Inject env config.
4.  **GitHubService (013):** Extract Octokit PR creation and description generation from agent.ts.
5.  **QueueService (014):** BullMQ Queue management with typed enqueue methods and idempotent job IDs.

### Phase 4: Controllers
**Goal:** Create typed HTTP endpoints replacing raw Express routes.
**Tasks:** 015-016

1.  **WebhookController (015):** `@Controller('/webhook')` with `@UseBefore(SignatureVerificationMiddleware)`. Routes: `@Post('/')` dispatching to issue/comment handlers. **Zero business logic** - delegates to services.
2.  **SystemController (016):** `@Controller('/')` with `/health` endpoint. BullBoard admin with basic auth.

### Phase 5: Execution Engine
**Goal:** Integrate worker and agent orchestration into Ts.ED lifecycle.
**Tasks:** 017-019

1.  **LangfuseService (017):** Trace lifecycle management.
2.  **AgentOrchestratorService (018):** Refactor `agent.ts` `runAgent()` into class. Must preserve:
    - Claude CLI spawning with isolated HOME directory
    - Cache seeding/persistence (`/app/claude-cache`)
    - Claude credential/skill copying
    - Three execution modes (plan-only, execute-only, full)
    - Iteration loop with validation
    - Rate limit detection (RateLimitError)
3.  **WorkerService (019):** BullMQ Worker lifecycle. Must preserve:
    - `concurrency: 1`, `lockDuration: 600000`, `lockRenewTime: 30000`
    - Tombstone writes on execution completion (1-year TTL)
    - RateLimitError → `moveToDelayed(Date.now() + 60000)`
    - Graceful shutdown via `@OnDestroy()`
    - Permanent failure reporting to Linear

### Phase 6: Testing & Cleanup
**Goal:** Migrate tests to PlatformTest, remove old files, update docs.
**Tasks:** 020-023

1.  **Webhook Tests (020):** Rewrite server.test.ts using `PlatformTest`.
2.  **Remaining Tests (021):** Migrate agent, worker, plan-store, tools tests.
3.  **Integration Wiring (022):** Verify all imports, build, full test suite.
4.  **Cleanup (023):** Remove old files, update CLAUDE.md, package.json, Dockerfile.

---

## 5. Specific Refactoring Rules for LLMs

*   **DRY Principle in Controllers:** Do not repeat payload inspection logic. Use specific routes or delegate to services.
*   **Error Handling:** Use Ts.ED's built-in `Exception` classes (`BadRequest`, `Unauthorized`, `InternalServerError`) instead of raw `res.status().send()`.
*   **Logging:** Replace `console.log` with `@tsed/logger`. This enables structured JSON logging (critical for K8s observability).
*   **Rate Limit Backpressure:** The `RateLimitError` handling (moving jobs to delayed state) in `worker.ts` must be preserved exactly in `WorkerService.ts`.
*   **Claude CLI Spawning:** The `runClaude()` function must remain as a plain function (or method). Do NOT abstract it behind an API client - it spawns a local process with specific environment variables and HOME directory isolation.
*   **Domain Purity:** Files in `domain/` must NOT import from `@tsed/*`. They remain pure TypeScript modules callable from anywhere.
*   **mcp-toonify.ts:** Do NOT touch this file. It's ESM, excluded from tsconfig, and runs independently.
*   **Tombstone Checks:** The tombstone read in the webhook handler and tombstone write in the worker completed handler must both be preserved.
*   **Iteration Workflow:** The `isIteration` flag controls PR creation (skip for iterations) and force-push behavior (no force push for iterations). Preserve this logic exactly.
