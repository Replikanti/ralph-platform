import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

dotenv.config();
const app = express();

// HTTP Request Logging
app.use(morgan('combined'));

const CONFIG_PATH = process.env.REPO_CONFIG_PATH || '/etc/ralph/config/repos.json';
const REDIS_CONFIG_KEY = 'ralph:config:repos';
const REDIS_VERSION_KEY = 'ralph:config:version';

// Redis & Queue Setup
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { 
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});
const ralphQueue = new Queue('ralph-tasks', { connection });

// Admin Dashboard (Protected)
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
    queues: [new BullMQAdapter(ralphQueue)],
    serverAdapter: serverAdapter,
});

const adminUser = process.env.ADMIN_USER;
const adminPass = process.env.ADMIN_PASS;

if (adminUser && adminPass) {
    app.use('/admin/queues', basicAuth({
        users: { [adminUser]: adminPass },
        challenge: true,
    }), serverAdapter.getRouter());
    console.log('🛡️ Admin dashboard enabled at /admin/queues');
} else {
    console.warn('⚠️ ADMIN_USER or ADMIN_PASS not set. Dashboard is disabled.');
}

// Team → Repository mapping logic
async function getRepoForTeam(teamKey: string | undefined): Promise<string | null> {
    try {
        // 1. Check Redis
        const [redisMap, redisVersion] = await Promise.all([
            connection.get(REDIS_CONFIG_KEY),
            connection.get(REDIS_VERSION_KEY)
        ]);

        let config: Record<string, string> = {};
        let currentVersion = '';

        // Check file version (mtime as simple version)
        try {
            const stats = await fs.stat(CONFIG_PATH);
            currentVersion = stats.mtimeMs.toString();
        } catch {
            // File might not exist in local dev, ignore
        }

        // If Redis is stale or empty, refresh from file
        if (!redisMap || redisVersion !== currentVersion) {
            try {
                const fileContent = await fs.readFile(CONFIG_PATH, 'utf-8');
                config = JSON.parse(fileContent);
                
                // Update Redis
                await Promise.all([
                    connection.set(REDIS_CONFIG_KEY, JSON.stringify(config)),
                    connection.set(REDIS_VERSION_KEY, currentVersion)
                ]);
                console.log("🔄 Configuration refreshed from ConfigMap");
            } catch (e) {
                console.warn("⚠️ Failed to refresh config from file, using Redis fallback:", e);
                // If file read fails (e.g. locally), fallback to Redis content if available
                if (redisMap) config = JSON.parse(redisMap);
            }
        } else {
            config = JSON.parse(redisMap);
        }

        // 2. Look up in config
        if (teamKey && config[teamKey]) {
            return config[teamKey];
        }
    } catch (e) {
        console.warn("⚠️ Error resolving repo config:", e);
    }

    // 3. Fallback to Env Var (Legacy)
    try {
        const envMap = JSON.parse(process.env.LINEAR_TEAM_REPOS || '{}');
        if (teamKey && envMap[teamKey]) {
            return envMap[teamKey];
        }
    } catch (e) {
        console.error('❌ Invalid LINEAR_TEAM_REPOS JSON', e);
    }

    if (process.env.DEFAULT_REPO_URL) {
        return process.env.DEFAULT_REPO_URL;
    }

    return null;
}

// Middleware to capture raw body for signature verification
app.use(express.json({
    verify: (req: any, _res: express.Response, buf: Buffer) => {
        req.rawBody = buf;
    }
}));

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

app.post('/webhook', async (req: express.Request, res: express.Response) => {
    if (!verifyLinearSignature(req)) {
        console.warn(`⚠️ [API] Invalid webhook signature from ${req.ip}`);
        return res.status(401).send('Invalid signature');
    }

    const { action, data, type } = req.body;
    
    // DEBUG: Log everything
    console.log(`🔍 [API] Webhook received: Type=${type}, Action=${action}, ID=${data?.id}`);
    if (data?.labels) {
        console.log(`🏷️ [API] Labels: ${data.labels.map((l: { name: string }) => l.name).join(', ')}`);
    } else {
        console.log(`🏷️ [API] No labels in payload.`);
    }

    // Filter: Only issues with label "Ralph"
    const labels = data.labels || [];
    const labelNames = labels.map((l: { name: string }) => l.name);
    const hasRalphLabel = labelNames.some((name: string) => name.toLowerCase() === 'ralph');

    if (type === 'Issue' && (action === 'create' || action === 'update')) {
        if (!hasRalphLabel) {
            console.log(`ℹ️ [API] Skipping ticket ${data.identifier} - Ralph label not present. Current labels: ${labelNames.join(', ')}`);
            return res.status(200).send({ status: 'ignored', reason: 'no_ralph_label' });
        }

        // Avoid re-triggering if already in progress or review
        const statusName = (data.state?.name || data.state?.label || '').toLowerCase();
        console.log(`📊 [API] Ticket ${data.identifier} current state: "${statusName}" (ID: ${data.stateId})`);
        
        if (action === 'update' && (statusName === 'in progress' || statusName === 'in review' || statusName === 'completed' || statusName === 'canceled' || statusName === 'done')) {
            console.log(`ℹ️ [API] Skipping ticket ${data.identifier} - Already in active/terminal state: ${statusName}`);
            return res.status(200).send({ status: 'ignored', reason: 'already_processed' });
        }

        const teamKey = data.team?.key;
        const repoUrl = await getRepoForTeam(teamKey);

        if (!repoUrl) {
            console.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}". Skipping issue: ${data.title}`);
            return res.status(200).send({ status: 'ignored', reason: 'no_repo_configured' });
        }

        console.log(`📥 [API] Enqueueing Ticket: ${data.title} (team: ${teamKey || 'default'}, repo: ${repoUrl})`);
        
        // Use data.id as jobId for deduplication. 
        // BullMQ will ignore duplicates if a job with this ID is already waiting, active, or completed (within retention period).
        try {
            await ralphQueue.add('coding-task', {
                ticketId: data.id,
                title: data.title,
                description: data.description,
                repoUrl,
                branchName: `ralph/feat-${data.identifier}`
            }, {
                jobId: data.id, 
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000
                },
                // Keep jobs for 1 hour to ensure identical webhooks are deduplicated
                removeOnComplete: { age: 3600 }, 
                removeOnFail: { age: 86400 } // Keep failed for 24h
            });
            res.status(200).send({ status: 'queued' });
        } catch (e) {
            console.error("❌ [API] Failed to add job to queue:", e);
            res.status(500).send({ error: 'queue_failed' });
        }
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
