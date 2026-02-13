import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent, updateLinearIssue, Task } from './agent';
import dotenv from 'dotenv';

dotenv.config();

// Create Redis connection for passing to agent
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

export const jobProcessor = async (job: Job) => {
    console.log(`🔨 [Worker] Processing ${job.id} (mode: ${job.data.mode || 'full'})`);

    // Inject job metadata into task data
    const taskData: Task = {
        ...job.data,
        jobId: job.id as string,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 1,
        mode: job.data.mode || 'full',
        existingPlan: job.data.existingPlan,
        additionalFeedback: job.data.additionalFeedback
    };

    await runAgent(taskData, redisConnection);
};

export const createWorker = () => {
    const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    console.log("👷 Ralph Worker Started");

    const worker = new Worker('ralph-tasks', jobProcessor, {
        connection,
        // Atomic locking: Ensure a task is processed by only one worker at a time.
        // This is a distributed lock managed by Redis (BullMQ built-in).
        concurrency: 1, 
        limiter: {
            max: 10,
            duration: 60000
        },
        // Infrastructure Safety: High lock duration with auto-renewal prevents 
        // race conditions during long-running LLM planning/execution phases.
        lockDuration: 600000, // 10 minutes (default is 30s)
        lockRenewTime: 30000, // Renew lock every 30s
    });

    worker.on('completed', (job) => {        console.log(`✅ [Worker] Job ${job.id} completed! Ticket: ${job.data.ticketId}`);
    });

    worker.on('failed', async (job, err) => {
        if (job) {
            console.error(`❌ [Worker] Job ${job.id} failed (Attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
            
            if (job.attemptsMade >= (job.opts.attempts || 1)) {
                 console.error(`💀 [Worker] Job ${job.id} FAILED PERMANENTLY. Reporting to Linear...`);
                 
                 // Report failure to Linear using the shared helper
                 try {
                     await updateLinearIssue(
                         job.data.ticketId, 
                         "Todo", // Or "Triage" / "Canceled" depending on workflow
                         `💀 Critical System Failure\n\nThe task failed permanently after ${job.attemptsMade} attempts.\n\nError: ${err.message}`
                     );
                 } catch (e) {
                     console.error("⚠️ Failed to report permanent failure to Linear:", e);
                 }
            }
        }
    });

    return worker;
};

if (require.main === module) {
    createWorker();
}