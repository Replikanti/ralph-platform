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
    const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

    console.log("👷 Ralph Worker Started");

    const worker = new Worker('ralph-tasks', jobProcessor, { 
        connection, 
        concurrency: 2, // Max parallel jobs per Pod
        limiter: {
            max: 5, // Rate limit (Anthropic protection)
            duration: 60000 
        }
    });

    return worker;
};

if (require.main === module) {
    createWorker();
}