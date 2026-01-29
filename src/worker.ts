import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent, updateLinearIssue, Task } from './agent';
import dotenv from 'dotenv';

dotenv.config();

export const jobProcessor = async (job: Job) => {
    console.log(`🔨 [Worker] Processing ${job.id}`);
    
    // Inject job metadata into task data
    const taskData: Task = {
        ...job.data,
        jobId: job.id as string,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 1
    };
    
    await runAgent(taskData);
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
        concurrency: 1, // Only 1 job at a time to prevent resource exhaustion
        limiter: {
            max: 10,
            duration: 60000
        },
        lockDuration: 600000, // 10 minutes (default is 30s) - critical for long LLM tasks
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