# Task 018: Create AgentOrchestratorService

## Objective
Refactor the massive `agent.ts` (795 lines) into a Ts.ED service class. This is the most complex task in the migration - it must preserve all execution modes, Claude CLI spawning, cache management, and validation logic.

## Prerequisites
- 006, 007 (domain layer: WorkspaceManager, AgentTools, PiiRedactor, PlanFormatter)
- 011 (PlanStoreService)
- 012 (LinearClientService)
- 013 (GitHubService)
- 017 (LangfuseService)

## Reference Files
- `src/agent.ts` (entire file - 795 lines)
- Read it completely before starting this task.

## Deliverables
- `src/services/AgentOrchestratorService.ts`

## Instructions

This service replaces the `runAgent()` export from agent.ts. It must preserve ALL existing behavior.

### Structure

```typescript
import { Service, Inject } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { spawn } from "node:child_process";
import fsPromises from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setupWorkspace } from "../domain/WorkspaceManager";
import { runPolyglotValidation, detectProjectLanguages } from "../domain/AgentTools";
import { formatPlanForLinear } from "../domain/PlanFormatter";
import { PlanStoreService, StoredPlan } from "./PlanStoreService";
import { LinearClientService } from "./LinearClientService";
import { GitHubService } from "./GitHubService";
import { LangfuseService } from "./LangfuseService";
import {
    ANTHROPIC_API_KEY,
    CLAUDE_BIN_PATH,
    CLAUDE_CACHE_PATH,
    PLAN_REVIEW_ENABLED,
} from "../config/env";

// --- Types (moved from agent.ts) ---
export interface Task {
    ticketId: string;
    title: string;
    description?: string;
    repoUrl: string;
    branchName: string;
    jobId: string;
    attempt: number;
    maxAttempts: number;
    mode?: "full" | "plan-only" | "execute-only";
    existingPlan?: string;
    additionalFeedback?: string;
    isIteration?: boolean;
}

export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RateLimitError";
    }
}

@Service()
export class AgentOrchestratorService {
    private logger = new Logger("AgentOrchestrator");

    @Inject() private planStore!: PlanStoreService;
    @Inject() private linear!: LinearClientService;
    @Inject() private github!: GitHubService;
    @Inject() private langfuse!: LangfuseService;

    // ... all methods from agent.ts refactored as class methods
}
```

### Methods to Migrate

Copy each function from `agent.ts` as a class method. Replace:
- `console.log` → `this.logger.info`
- `console.warn` → `this.logger.warn`
- `console.error` → `this.logger.error`
- `new RalphLinearClient()` → `this.linear`
- `createPullRequest(...)` → `this.github.createPullRequest(...)`
- `generatePRDescription(...)` → `this.github.generatePRDescription(...)`
- `storePlan(redis, ...)` → `this.planStore.storePlan(...)`
- `deletePlan(redis, ...)` → `this.planStore.deletePlan(...)`
- `updateLinearIssue(...)` → `this.linear.updateIssueWithComment(...)`
- `formatPlanForLinear(...)` → imported from domain
- `withTrace(...)` → `this.langfuse.withTrace(...)`

### Functions to Migrate (in order)

1. **`runClaude()`** → `private runClaude(args, cwd, homeDir, timeoutMs?)` - Keep as method. Uses `spawn()`. Must preserve env vars: `HOME`, `ANTHROPIC_API_KEY`, `CI`, `DEBUG`, `TERM`, `CLAUDE_CODE_ANALYTICS`.
2. **`SECURITY_GUARDRAILS`** → `private readonly SECURITY_GUARDRAILS` constant
3. **`listAvailableSkills()`** → `private async listAvailableSkills(workDir)`
4. **`planPhase()`** → `private async planPhase(workDir, homeDir, task, availableSkills, previousErrors?)`
5. **`executePhase()`** → `private async executePhase(workDir, homeDir, plan)`
6. **Cache management**: `seedClaudeCache()`, `persistClaudeCache()`, `syncDirectoryContents()` → private methods
7. **Claude env setup**: `setupClaudeEnvironment()`, `copyClaudeCredentials()`, `configureClaudeSettings()`, `ensureClaudeCredentialsExist()`, `prepareClaudeSkills()` → private methods
8. **`summarizeFailurePhase()`** → private method (uses Haiku 4.5, $0.10 budget)
9. **`runIteration()`** → private method
10. **`handleFailureFallback()`** → private method
11. **`runFullMode()`** → private method
12. **`handlePlanOnlyMode()`** → private method
13. **`handleExecuteOnlyMode()`** → private method
14. **`handleValidationSuccess()`** → private method
15. **`handleValidationFailure()`** → private method
16. **`handleIterationCompletion()`** → private method
17. **`handlePRCreationAndStateUpdate()`** → private method
18. **`detectTaskType()`** → private helper
19. **`runAgent()`** → `public async runAgent(task: Task)` - main entry point

### Critical Preservation Requirements

1. **Claude CLI spawning**: The `runClaude()` function MUST use `spawn()` with the exact same environment variables and arguments. Do NOT replace with direct Anthropic SDK calls.
2. **Isolated HOME directory**: Each job creates `{rootDir}/home/.claude/` with credentials, settings, and MCP config. This isolation is critical for concurrent jobs.
3. **Cache seeding/persistence**: The `CLAUDE_CACHE_ROOT` (`/app/claude-cache`) pattern must be preserved. Cache is seeded before execution and persisted after each iteration.
4. **Three execution modes**: `plan-only`, `execute-only`, `full` - all preserved with exact same behavior.
5. **RateLimitError**: Must be thrown when stderr contains '429' or 'rate limit'. The WorkerService catches this.
6. **Iteration workflow**: `isIteration` flag controls force-push behavior and PR creation.
7. **3-second Linear wait**: After PR creation, wait 3 seconds for Linear auto-switch to "In Review" before manually checking.

### Key Difference: No Redis Parameter

The old `runAgent(task, redis?)` passed an IORedis connection. In the new architecture, PlanStoreService is injected and manages its own Redis connection. Remove the `redis` parameter from `runAgent()`.

### Important Notes

- This is the LARGEST task. Take time to ensure all paths are covered.
- The `workspace.cleanup()` MUST be called in the `finally` block of `runAgent()`.
- The `CLAUDE_CACHE_ROOT` directory creation (line 343-348 in agent.ts) should happen in the constructor or `$onInit()`.

## Acceptance Criteria
- [ ] `src/services/AgentOrchestratorService.ts` exists with `@Service()` decorator
- [ ] All services injected: PlanStoreService, LinearClientService, GitHubService, LangfuseService
- [ ] `Task` interface and `RateLimitError` class exported
- [ ] `runAgent(task: Task)` public method as main entry point
- [ ] All three modes work: plan-only, execute-only, full
- [ ] Claude CLI spawning preserved with isolated HOME dir
- [ ] Cache seeding/persistence preserved
- [ ] RateLimitError thrown on 429/rate limit detection
- [ ] Iteration workflow preserved (isIteration flag)
- [ ] `workspace.cleanup()` in finally block
- [ ] `npm run build` compiles without errors
