import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(express.json());

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const ralphQueue = new Queue('ralph-tasks', { connection });

app.post('/webhook', async (req, res) => {
    const { action, data, type } = req.body;
    
    // Filter: Only issues with label "Ralph"
    if (type === 'Issue' && (action === 'create' || action === 'update') && 
        data.labels?.some((l: any) => l.name.toLowerCase() === 'ralph')) {
        
        console.log(`📥 [API] Enqueueing Ticket: ${data.title}`);
        await ralphQueue.add('coding-task', {
            ticketId: data.id,
            title: data.title,
            description: data.description,
            // In prod, map Linear Team ID to Repo URL
            repoUrl: process.env.DEFAULT_REPO_URL || "[https://github.com/duvo-ai/flowlint](https://github.com/duvo-ai/flowlint)", 
            branchName: `ralph/feat-${data.identifier}`
        });
        res.status(200).send({ status: 'queued' });
    } else {
        res.status(200).send({ status: 'ignored' });
    }
});

if (require.main === module) {
    app.listen(3000, () => console.log('🚀 API listening on 3000'));
}

export { app };
