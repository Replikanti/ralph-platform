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
