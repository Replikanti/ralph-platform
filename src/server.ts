import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();
const app = express();

// Middleware to capture raw body for signature verification
app.use(express.json({
    verify: (req: any, _res, buf) => {
        req.rawBody = buf;
    }
}));

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { 
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});
const ralphQueue = new Queue('ralph-tasks', { connection });

function verifyLinearSignature(req: any): boolean {
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    if (!secret) {
        console.error("❌ LINEAR_WEBHOOK_SECRET is not set!");
        return false;
    }

    const signature = req.headers['linear-signature'];
    if (!signature || typeof signature !== 'string') return false;

    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(req.rawBody || '').digest('hex');
    
    const signatureBuffer = Buffer.from(signature);
    const digestBuffer = Buffer.from(digest);

    if (signatureBuffer.length !== digestBuffer.length) {
        return false;
    }
    
    return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
}

app.post('/webhook', async (req, res) => {
    if (!verifyLinearSignature(req)) {
        return res.status(401).send('Invalid signature');
    }

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
            repoUrl: process.env.DEFAULT_REPO_URL || "https://github.com/Replikanti/ralph-platform", 
            branchName: `ralph/feat-${data.identifier}`
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            },
            removeOnComplete: true, // Keep DB clean
            removeOnFail: false     // Keep failed jobs for inspection
        });
        res.status(200).send({ status: 'queued' });
    } else {
        res.status(200).send({ status: 'ignored' });
    }
});

app.get('/health', (_req, res) => {
    res.status(200).send({ status: 'ok' });
});

if (require.main === module) {
    app.listen(3000, () => console.log('🚀 API listening on 3000'));
}

export { app };
