import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent } from './agent';
import dotenv from 'dotenv';

dotenv.config();

export const jobProcessor = async (job: any) => {
    console.log(`🔨 [Worker] Processing ${job.id}`);
    await runAgent(job.data);
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

    worker.on('failed', (job, err) => {
        if (job) {
            console.error(`❌ [Worker] Job ${job.id} failed (Attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
            
            // Check if this was the final attempt
            if (job.attemptsMade >= (job.opts.attempts || 1)) {
                 console.error(`💀 [Worker] Job ${job.id} FAILED PERMANENTLY. Reporting to Linear...`);
                 console.warn("⚠️ Linear API notification not yet implemented.");
            }
        }
    });

    return worker;
};

if (require.main === module) {
    createWorker();
}