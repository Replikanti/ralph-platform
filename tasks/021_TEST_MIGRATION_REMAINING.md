# Task 021: Migrate Remaining Tests

## Objective
Migrate agent, worker, plan-store, tools, workspace, linear-client, and plan-formatter tests to work with the new Ts.ED service architecture.

## Prerequisites
- 018 (AgentOrchestratorService)
- 019 (WorkerService)
- 020 (WebhookController tests as reference pattern)

## Reference Files
- `tests/agent.test.ts` (agent execution modes, Claude CLI mocking)
- `tests/worker.test.ts` (BullMQ job processing, retries)
- `tests/plan-store.test.ts` (Redis plan persistence)
- `tests/tools.test.ts` (polyglot validation, command security)
- `tests/workspace.test.ts` (git workspace management)
- `tests/linear-client.test.ts` (Linear API integration)
- `tests/plan-formatter.test.ts` (plan formatting)

## Deliverables
- `tests/services/AgentOrchestratorService.test.ts`
- `tests/services/WorkerService.test.ts`
- `tests/services/PlanStoreService.test.ts`
- `tests/services/LinearClientService.test.ts`
- `tests/services/GitHubService.test.ts`
- `tests/domain/AgentTools.test.ts`
- `tests/domain/WorkspaceManager.test.ts`
- `tests/domain/PlanFormatter.test.ts`

## Instructions

### Service Tests Pattern (using PlatformTest)

For services that use DI:

```typescript
import { PlatformTest } from "@tsed/common";
import { PlanStoreService } from "../../src/services/PlanStoreService";
import { RedisProvider } from "../../src/services/RedisProvider";

describe("PlanStoreService", () => {
    let service: PlanStoreService;
    const mockRedis = {
        connection: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
        },
    };

    beforeAll(async () => {
        await PlatformTest.create({
            imports: [PlanStoreService],
        });
        PlatformTest.injector.addProvider(RedisProvider, { useValue: mockRedis });
        service = PlatformTest.get<PlanStoreService>(PlanStoreService);
    });

    afterAll(() => PlatformTest.reset());

    // Migrate test cases from tests/plan-store.test.ts
});
```

### Domain Tests Pattern (no DI needed)

Domain files are pure functions - test them directly without PlatformTest:

```typescript
import { runPolyglotValidation, runCommand, ALLOWED_COMMAND_PATTERNS } from "../../src/domain/AgentTools";

describe("AgentTools", () => {
    // Migrate test cases from tests/tools.test.ts
    // These tests can use jest.mock() for child_process since
    // domain files don't use DI
});
```

### Test Migration Map

| Old Test File | New Test File | Pattern |
|---|---|---|
| `tests/agent.test.ts` | `tests/services/AgentOrchestratorService.test.ts` | PlatformTest + mock services |
| `tests/worker.test.ts` | `tests/services/WorkerService.test.ts` | PlatformTest + mock orchestrator |
| `tests/plan-store.test.ts` | `tests/services/PlanStoreService.test.ts` | PlatformTest + mock Redis |
| `tests/linear-client.test.ts` | `tests/services/LinearClientService.test.ts` | PlatformTest + mock Linear SDK |
| `tests/tools.test.ts` | `tests/domain/AgentTools.test.ts` | Direct import, jest.mock child_process |
| `tests/workspace.test.ts` | `tests/domain/WorkspaceManager.test.ts` | Direct import, jest.mock simple-git |
| `tests/plan-formatter.test.ts` | `tests/domain/PlanFormatter.test.ts` | Direct import, no mocks needed |

### Key Considerations

1. **Agent tests**: The hardest to migrate. Currently mock `child_process.spawn` to simulate Claude CLI. Same approach works in the service - `spawn` is called directly (not through DI), so `jest.mock('node:child_process')` is still needed.
2. **Worker tests**: Mock `AgentOrchestratorService.runAgent()` via DI override. Test job processing, rate limit handling, tombstone writes.
3. **Domain tests**: These are the easiest - just update import paths from `../src/tools` to `../../src/domain/AgentTools`.

### Important Notes

- Keep old test files during migration. They'll be removed in Task 023.
- New test files should go in `tests/services/` and `tests/domain/` subdirectories.
- Create `tests/services/` and `tests/domain/` directories.
- Update `jest.config.js` `testMatch` if needed: `['**/tests/**/*.test.ts']` already covers subdirectories.

## Acceptance Criteria
- [ ] All test files created in `tests/services/` and `tests/domain/`
- [ ] Service tests use PlatformTest with DI provider overrides
- [ ] Domain tests use direct imports (no PlatformTest)
- [ ] All test scenarios from old tests migrated
- [ ] `npm test` passes with all new tests
- [ ] Test coverage maintained or improved
