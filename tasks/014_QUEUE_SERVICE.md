# Task 014: Create QueueService

## Objective
Manage the BullMQ Queue instance in an injectable Ts.ED service with typed enqueue methods and idempotent job IDs.

## Prerequisites
- 004 (RedisProvider exists)
- 011 (StoredPlan interface available)

## Reference Files
- `src/server.ts` lines 37 (Queue creation)
- `src/server.ts` lines 175-197 (`enqueueJob` function)
- `src/server.ts` lines 199-283 (specific enqueue functions)
- `src/server.ts` lines 394-415 (issue job enqueueing)

## Deliverables
- `src/services/QueueService.ts`

## Instructions

```typescript
import { Service, Inject, OnInit, OnDestroy } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { Queue } from "bullmq";
import { RedisProvider } from "./RedisProvider";

export interface EnqueueResult {
    status: string;
    jobId: string;
}

@Service()
export class QueueService implements OnInit, OnDestroy {
    private queue!: Queue;
    private logger = new Logger("QueueService");

    @Inject()
    private redis!: RedisProvider;

    $onInit(): void {
        this.queue = new Queue("ralph-tasks", {
            connection: this.redis.connection,
        });
        this.logger.info("BullMQ Queue initialized");
    }

    async $onDestroy(): Promise<void> {
        await this.queue.close();
        this.logger.info("BullMQ Queue closed");
    }

    /**
     * Get the Queue instance (for BullBoard integration).
     */
    getQueue(): Queue {
        return this.queue;
    }

    private async enqueue(jobData: any, jobId: string, logType: string): Promise<EnqueueResult> {
        this.logger.info(`Adding ${logType} job to queue (ID: ${jobId})`);

        await this.queue.add("coding-task", jobData, {
            jobId,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true,
            removeOnFail: true,
        });

        this.logger.info(`Successfully enqueued ${logType} job ${jobId}`);
        return { status: `${logType}_queued`, jobId };
    }

    /**
     * Enqueue a new issue (plan-only or full mode).
     * Job ID = issue ID (prevents duplicate processing).
     */
    async enqueueIssue(data: {
        ticketId: string;
        title: string;
        description?: string;
        repoUrl: string;
        branchName: string;
    }): Promise<EnqueueResult> {
        return this.enqueue(data, data.ticketId, "issue");
    }

    /**
     * Enqueue plan execution after approval.
     * Job ID = {issueId}-exec (prevents concurrent executions).
     */
    async enqueueExecution(data: {
        ticketId: string;
        title: string;
        description?: string;
        repoUrl: string;
        branchName: string;
        mode: "execute-only";
        existingPlan: string;
        isIteration?: boolean;
    }): Promise<EnqueueResult> {
        const jobId = `${data.ticketId}-exec`;
        return this.enqueue(data, jobId, "execution");
    }

    /**
     * Enqueue replanning after feedback.
     * Job ID = {issueId}-replan (prevents concurrent replans).
     */
    async enqueueReplanning(data: {
        ticketId: string;
        title: string;
        description?: string;
        repoUrl: string;
        branchName: string;
        mode: "plan-only";
        additionalFeedback: string;
    }): Promise<EnqueueResult> {
        const jobId = `${data.ticketId}-replan`;
        return this.enqueue(data, jobId, "replanning");
    }

    /**
     * Enqueue PR iteration (fix request on existing PR).
     * Job ID = {issueId}-iterate (prevents concurrent iterations).
     */
    async enqueueIteration(data: {
        ticketId: string;
        title: string;
        description?: string;
        repoUrl: string;
        branchName: string;
        mode: "plan-only";
        additionalFeedback: string;
        isIteration: true;
    }): Promise<EnqueueResult> {
        const jobId = `${data.ticketId}-iterate`;
        return this.enqueue(data, jobId, "iteration");
    }
}
```

### Key Design Decisions

1. **Typed enqueue methods**: Instead of one generic `enqueueJob`, each workflow has its own typed method with the correct job ID pattern.
2. **Idempotent job IDs**: Fixed patterns from server.ts preserved:
   - Issue: `data.id`
   - Execution: `{issueId}-exec`
   - Replanning: `{issueId}-replan`
   - Iteration: `{issueId}-iterate`
3. **Job options**: All jobs use `removeOnComplete: true, removeOnFail: true` for immediate cleanup (allows re-runs).
4. **`getQueue()` accessor**: Needed by SystemController for BullBoard integration.
5. **Lifecycle**: Queue created in `$onInit()` (after RedisProvider is ready), closed in `$onDestroy()`.

## Acceptance Criteria
- [ ] `src/services/QueueService.ts` exists with `@Service()` decorator
- [ ] Implements `$onInit()` and `$onDestroy()` lifecycle hooks
- [ ] Four typed enqueue methods: `enqueueIssue`, `enqueueExecution`, `enqueueReplanning`, `enqueueIteration`
- [ ] Job ID patterns match current server.ts behavior exactly
- [ ] Job options: `attempts: 3`, exponential backoff 2000ms, `removeOnComplete: true`, `removeOnFail: true`
- [ ] `getQueue()` method for BullBoard integration
- [ ] `npm run build` compiles without errors
