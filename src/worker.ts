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
        concurrency: 2, // Max parallel jobs per Pod
        limiter: {
            max: 5, // Rate limit (Anthropic protection)
            duration: 60000 
        }
    });

    worker.on('completed', (job) => {
        console.log(`✅ [Worker] Job ${job.id} completed! Ticket: ${job.data.ticketId}`);
    });

    worker.on('failed', (job, err) => {
        if (job) {
            console.error(`❌ [Worker] Job ${job.id} failed (Attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
            
            // Check if this was the final attempt
            if (job.attemptsMade >= (job.opts.attempts || 1)) {
                 console.error(`💀 [Worker] Job ${job.id} FAILED PERMANENTLY. Reporting to Linear...`);
                 // TODO: Call Linear API to comment on issue with error
            }
        }
    });

    return worker;
};

if (require.main === module) {
    createWorker();
}