# Task 020: Migrate Webhook Tests to PlatformTest

## Objective
Rewrite `tests/server.test.ts` using Ts.ED's `PlatformTest` utilities, replacing manual Express app setup and `jest.mock()` patterns with DI-based provider overrides.

## Prerequisites
- 015 (WebhookController)
- 016 (SystemController)
- All services (010-014)

## Reference Files
- `tests/server.test.ts` (current tests - read completely before starting)
- `tests/fixtures/webhook-payloads.ts` (test payloads)
- `tests/fixtures/mocks.ts` (mock factories)

## Deliverables
- `tests/controllers/WebhookController.test.ts`
- `tests/controllers/SystemController.test.ts`

## Instructions

### PlatformTest Pattern

```typescript
import { PlatformTest } from "@tsed/common";
import SuperTest from "supertest";
import { Server } from "../../src/Server";
import { WebhookController } from "../../src/controllers/WebhookController";
import { QueueService } from "../../src/services/QueueService";
import { ConfigService } from "../../src/services/ConfigService";
import { PlanStoreService } from "../../src/services/PlanStoreService";
import { LinearClientService } from "../../src/services/LinearClientService";
import { RedisProvider } from "../../src/services/RedisProvider";

describe("WebhookController", () => {
    let request: SuperTest.SuperTest<SuperTest.Test>;

    // Mock services
    const mockQueue = {
        enqueueIssue: jest.fn().mockResolvedValue({ status: "queued", jobId: "test-id" }),
        enqueueExecution: jest.fn().mockResolvedValue({ status: "queued", jobId: "test-exec" }),
        enqueueReplanning: jest.fn().mockResolvedValue({ status: "queued", jobId: "test-replan" }),
        enqueueIteration: jest.fn().mockResolvedValue({ status: "queued", jobId: "test-iterate" }),
        getQueue: jest.fn(),
    };

    const mockConfig = {
        getRepoForTeam: jest.fn().mockResolvedValue("https://github.com/test/repo"),
    };

    const mockPlanStore = {
        getPlan: jest.fn().mockResolvedValue(null),
        storePlan: jest.fn(),
        deletePlan: jest.fn(),
    };

    const mockLinear = {
        updateIssueState: jest.fn().mockResolvedValue(true),
        postComment: jest.fn(),
        isEnabled: jest.fn().mockReturnValue(true),
        updateIssueWithComment: jest.fn(),
    };

    const mockRedis = {
        connection: {
            get: jest.fn().mockResolvedValue(null), // No tombstone by default
            set: jest.fn(),
        },
    };

    beforeAll(async () => {
        const platform = await PlatformTest.bootstrap(Server, {
            mount: {
                "/": [WebhookController],
            },
        });

        // Override services with mocks
        PlatformTest.injector.addProvider(QueueService, { useValue: mockQueue });
        PlatformTest.injector.addProvider(ConfigService, { useValue: mockConfig });
        PlatformTest.injector.addProvider(PlanStoreService, { useValue: mockPlanStore });
        PlatformTest.injector.addProvider(LinearClientService, { useValue: mockLinear });
        PlatformTest.injector.addProvider(RedisProvider, { useValue: mockRedis });

        request = SuperTest(PlatformTest.callback());
    });

    afterAll(async () => {
        await PlatformTest.reset();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // --- Tests migrated from server.test.ts ---

    describe("Signature Verification", () => {
        it("should reject requests with invalid signature", async () => {
            // ... test with wrong linear-signature header
        });

        it("should accept requests with valid signature", async () => {
            // ... test with correct HMAC signature
        });
    });

    describe("Issue Webhooks", () => {
        it("should skip issues without Ralph label", async () => {
            // ... mock payload without Ralph label
        });

        it("should enqueue issues with Ralph label", async () => {
            // ... mock payload with Ralph label
            // expect(mockQueue.enqueueIssue).toHaveBeenCalled()
        });

        it("should skip issues in terminal states on update", async () => {
            // ... mock payload with "In Progress" state
        });

        it("should skip issues with tombstone", async () => {
            mockRedis.connection.get.mockResolvedValueOnce("true");
            // ... expect ignored response
        });
    });

    describe("Comment Webhooks", () => {
        it("should ignore Ralph's own comments", async () => {
            // ... comment from "Ralph Bot" author
        });

        it("should process approval comment on stored plan", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce({ /* stored plan */ });
            // ... "LGTM" comment
            // expect(mockQueue.enqueueExecution).toHaveBeenCalled()
        });

        it("should process feedback on stored plan", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce({ /* stored plan */ });
            // ... feedback comment
            // expect(mockQueue.enqueueReplanning).toHaveBeenCalled()
        });

        it("should handle PR iteration for in-review issues", async () => {
            // ... issue in "In Review" state, no stored plan
            // expect(mockQueue.enqueueIteration).toHaveBeenCalled()
        });
    });
});
```

### Key Differences from Current Tests

1. **No `jest.mock()`**: Services are overridden via `PlatformTest.injector.addProvider()` instead of module-level mocking.
2. **No manual signature computation**: The SignatureVerificationMiddleware is tested as part of the integration.
3. **SuperTest against PlatformTest.callback()**: Instead of `supertest(app)`, use `SuperTest(PlatformTest.callback())`.
4. **Cleaner setup**: No need to manually construct Express app or wire middleware.

### Test Coverage to Preserve

Migrate ALL test cases from `tests/server.test.ts`. Key scenarios:
- Webhook signature verification (valid/invalid/missing)
- Ralph label filtering
- Terminal state skip logic
- Tombstone checking
- Ralph's own comment filtering
- Plan approval flow
- Plan revision flow
- PR iteration flow
- Repo mapping (team key → repo URL)

## Acceptance Criteria
- [ ] `tests/controllers/WebhookController.test.ts` exists
- [ ] Uses `PlatformTest.bootstrap()` and `PlatformTest.reset()`
- [ ] All test scenarios from `tests/server.test.ts` migrated
- [ ] Services mocked via DI provider overrides (not `jest.mock()`)
- [ ] Tests pass with `npm test`
