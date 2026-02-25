import { Service, Inject, OnInit, OnDestroy } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { Worker, Job } from "bullmq";
import { RedisProvider } from "./RedisProvider";
import { AgentOrchestratorService, Task, RateLimitError } from "./AgentOrchestratorService";
import { LinearClientService } from "./LinearClientService";

@Service()
export class WorkerService implements OnInit, OnDestroy {
    private worker!: Worker;
    private logger = new Logger("WorkerService");

    @Inject() private redis!: RedisProvider;
    @Inject() private orchestrator!: AgentOrchestratorService;
    @Inject() private linear!: LinearClientService;

    $onInit(): void {
        this.worker = new Worker("ralph-tasks", (job) => this.processJob(job), {
            connection: this.redis.connection,
            // Atomic locking: single job per worker pod
            concurrency: 1,
            limiter: {
                max: 10,
                duration: 60000,
            },
            // High lock duration for long-running LLM tasks (10 minutes)
            lockDuration: 600000,
            lockRenewTime: 30000,
        });

        this.worker.on("completed", (job) => this.onCompleted(job));
        this.worker.on("failed", (job, err) => this.onFailed(job, err));

        this.logger.info("BullMQ Worker started (concurrency: 1, lock: 600s)");
    }

    async $onDestroy(): Promise<void> {
        this.logger.info("Shutting down worker (waiting for active job)...");
        await this.worker.close();
        this.logger.info("Worker shut down gracefully");
    }

    private async processJob(job: Job): Promise<void> {
        this.logger.info(`Processing ${job.id} (mode: ${job.data.mode || "full"})`);

        const taskData: Task = {
            ...job.data,
            jobId: job.id as string,
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts || 1,
            mode: job.data.mode || "full",
            existingPlan: job.data.existingPlan,
            additionalFeedback: job.data.additionalFeedback,
        };

        try {
            await this.orchestrator.runAgent(taskData);
        } catch (e: any) {
            if (e.name === "RateLimitError") {
                this.logger.warn(`Rate Limit hit for job ${job.id}. Backing off for 60s...`);
                await job.moveToDelayed(Date.now() + 60000, job.token);
                return;
            }
            throw e; // Rethrow to trigger standard BullMQ retry
        }
    }

    private async onCompleted(job: Job): Promise<void> {
        this.logger.info(`Job ${job.id} completed! Ticket: ${job.data.ticketId}`);

        // Write tombstone for execution jobs to prevent re-processing
        if (job.data.mode === "execute-only" || job.data.mode === "full") {
            const tombstoneKey = `ralph:tombstone:${job.data.ticketId}`;
            await this.redis.connection.set(tombstoneKey, "true", "EX", 31536000); // 1 year
            this.logger.info(`Tombstone set for ticket ${job.data.ticketId}`);
        }
    }

    private async onFailed(job: Job | undefined, err: Error): Promise<void> {
        if (!job) return;

        this.logger.error(
            `Job ${job.id} failed (Attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`
        );

        // Report permanent failure to Linear
        if (job.attemptsMade >= (job.opts.attempts || 1)) {
            this.logger.error(`Job ${job.id} FAILED PERMANENTLY. Reporting to Linear...`);

            try {
                await this.linear.updateIssueWithComment(
                    job.data.ticketId,
                    "Todo",
                    `Critical System Failure\n\nThe task failed permanently after ${job.attemptsMade} attempts.\n\nError: ${err.message}`
                );
            } catch (e: any) {
                this.logger.error("Failed to report permanent failure to Linear:", e.message);
            }
        }
    }
}
