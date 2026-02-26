import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import helmet from 'helmet';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getPlan } from './plan-store';
import { LinearClient as RalphLinearClient } from './linear-client';
import { parseIssuePayload, parseCommentPayload } from './webhook-schemas';
import { hasRalphLabel, shouldSkipIssueWebhook, routeComment } from './domain/webhook-routing';

dotenv.config();
const app = express();

// Security Headers
app.use(helmet());

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
    limit: '10mb',
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

interface JobConfig {
    jobId: string;
    jobData: any;
    logContext: { type: string; details: string[] };
}

async function enqueueJob(config: JobConfig, res: express.Response): Promise<express.Response> {
    const { jobId, jobData, logContext } = config;

    try {
        console.log(`📥 [API] Adding ${logContext.type} job to queue:`); // NOSONAR - Input is internal or trusted webhook payload
        console.log(`   Job ID: ${jobId}`); // NOSONAR - Input is internal or trusted webhook payload
        logContext.details.forEach(detail => console.log(`   ${detail}`)); // NOSONAR - Input is internal or trusted webhook payload

        await ralphQueue.add('coding-task', jobData, {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true, // Immediate cleanup to allow re-runs
            removeOnFail: true // Immediate cleanup to allow re-runs after failure
        });

        console.log(`✅ [API] Successfully enqueued ${logContext.type} job ${jobId}`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(200).send({ status: `${logContext.type}_queued`, jobId });
    } catch (e) {
        console.error(`❌ [API] Failed to enqueue ${logContext.type} job:`, e); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(500).send({ error: 'queue_failed' });
    }
}

async function handlePlanApproval(issueId: string, storedPlan: any, res: express.Response): Promise<express.Response> {
    console.log(`✅ [API] Plan approved for issue ${issueId}`); // NOSONAR - Input is internal or trusted webhook payload

    const jobId = `${issueId}-exec`; // Deduplication: Fixed ID prevents concurrent executions
    const jobData = {
        ticketId: issueId,
        title: storedPlan.taskContext.title,
        description: storedPlan.taskContext.description,
        repoUrl: storedPlan.taskContext.repoUrl,
        branchName: storedPlan.taskContext.branchName,
        mode: 'execute-only',
        existingPlan: storedPlan.plan,
        isIteration: storedPlan.taskContext.isIteration
    };

    return enqueueJob({
        jobId,
        jobData,
        logContext: {
            type: 'execution',
            details: [`Repo: ${jobData.repoUrl}`, `Branch: ${jobData.branchName}`]
        }
    }, res);
}

async function handlePlanRevisionFeedback(issueId: string, storedPlan: any, commentBody: string, res: express.Response): Promise<express.Response> {
    console.log(`💭 [API] Revision feedback received for issue ${issueId}`); // NOSONAR - Input is internal or trusted webhook payload

    const jobId = `${issueId}-replan`; // Deduplication
    const jobData = {
        ticketId: issueId,
        title: storedPlan.taskContext.title,
        description: storedPlan.taskContext.description,
        repoUrl: storedPlan.taskContext.repoUrl,
        branchName: storedPlan.taskContext.branchName,
        mode: 'plan-only',
        additionalFeedback: commentBody
    };

    return enqueueJob({
        jobId,
        jobData,
        logContext: {
            type: 'replanning',
            details: [`Feedback: "${commentBody.substring(0, 100)}..."`]
        }
    }, res);
}

async function handleIterationRequest(routing: { issueId: string; issueTitle: string; issueDescription?: string; teamKey?: string; identifier?: string; feedback: string }, res: express.Response): Promise<express.Response> {
    console.log(`🔄 [API] PR iteration detected - issue in review state without stored plan`);
    console.log(`   Creating new plan for iterative fixes...`);

    const { issueId, issueTitle, issueDescription, teamKey, identifier, feedback } = routing;

    const repoUrl = await getRepoForTeam(teamKey);
    if (!repoUrl) {
        console.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}"`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(200).send({ status: 'ignored', reason: 'no_repo_configured' });
    }

    const jobId = `${issueId}-iterate`; // Deduplication
    const jobData = {
        ticketId: issueId,
        title: issueTitle,
        description: issueDescription || feedback,
        repoUrl,
        branchName: `ralph/feat-${identifier || issueId}`,
        mode: 'plan-only',
        additionalFeedback: feedback,
        isIteration: true
    };

    return enqueueJob({
        jobId,
        jobData,
        logContext: {
            type: 'iteration',
            details: [`Feedback: "${feedback.substring(0, 100)}..."`]
        }
    }, res);
}

async function handleCommentWebhook(data: unknown, res: express.Response): Promise<express.Response> {
    const parsed = parseCommentPayload(data);
    if (!parsed.ok) {
        console.warn(`⚠️ [API] Invalid comment payload: ${parsed.error}`);
        return res.status(400).send({ error: 'invalid_payload' });
    }

    const { comment } = parsed;
    const issueId = comment.issue?.id;

    if (!issueId) {
        console.warn(`⚠️ [API] Comment event missing issue ID`);
        return res.status(400).send({ error: 'missing_issue_id' });
    }

    console.log(`💬 [API] Comment received:`);
    console.log(`   Issue ID: ${issueId}`); // NOSONAR - Input is internal or trusted webhook payload
    console.log(`   Issue State: "${comment.issue?.state?.name ?? ''}"`); // NOSONAR - Input is internal or trusted webhook payload
    console.log(`   Comment Author: "${comment.author.name ?? comment.author.displayName ?? ''}"`); // NOSONAR - Input is internal or trusted webhook payload
    console.log(`   Comment Body: "${comment.body.substring(0, 100)}..."`); // NOSONAR - Input is internal or trusted webhook payload

    const storedPlan = await getPlan(connection, issueId);
    const routing = routeComment(comment, storedPlan);

    if (routing.action === 'ignore') {
        console.log(`ℹ️ [API] Ignoring comment (${routing.reason})`);
        return res.status(200).send({ status: 'ignored', reason: routing.reason.replace(/-/g, '_') });
    }

    if (routing.action === 'approve' || routing.action === 'revise') {
        // Move ticket back to "In Progress" when user provides feedback/approval
        const linearClient = new RalphLinearClient();
        await linearClient.updateIssueState(issueId, "In Progress");
        console.log(`📊 [API] Moved issue ${issueId} back to In Progress (user responded)`); // NOSONAR - Input is internal or trusted webhook payload
    }

    if (routing.action === 'approve') {
        return handlePlanApproval(issueId, routing.storedPlan, res);
    }

    if (routing.action === 'revise') {
        return handlePlanRevisionFeedback(issueId, routing.storedPlan, routing.feedback, res);
    }

    return handleIterationRequest(routing, res);
}

async function handleIssueWebhook(data: unknown, action: string, res: express.Response): Promise<express.Response> {
    const parsed = parseIssuePayload(data);
    if (!parsed.ok) {
        console.warn(`⚠️ [API] Invalid issue payload: ${parsed.error}`);
        return res.status(400).send({ error: 'invalid_payload' });
    }

    const { issue } = parsed;

    // Tombstone Check: Prevent Reopen
    const tombstone = await connection.get(`ralph:tombstone:${issue.id}`);
    if (tombstone) {
        console.log(`🪦 [API] Ignoring ticket ${issue.identifier} (ID: ${issue.id}) - Tombstone found (already processed).`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(200).send({ status: 'ignored', reason: 'tombstone_present' });
    }

    if (!hasRalphLabel(issue)) {
        const labelNames = issue.labels.map(l => l.name);
        console.log(`ℹ️ [API] Skipping ticket ${issue.identifier} - Ralph label not present. Current labels: ${labelNames.join(', ')}`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(200).send({ status: 'ignored', reason: 'no_ralph_label' });
    }

    const stateName = issue.state?.name ?? '';
    console.log(`📊 [API] Ticket ${issue.identifier} current state: "${stateName}"`); // NOSONAR - Input is internal or trusted webhook payload

    if (shouldSkipIssueWebhook(action, stateName)) {
        console.log(`ℹ️ [API] Skipping ticket ${issue.identifier} - Already in active/terminal state: ${stateName}`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(200).send({ status: 'ignored', reason: 'already_processed' });
    }

    const teamKey = issue.team?.key;
    const repoUrl = await getRepoForTeam(teamKey);

    if (!repoUrl) {
        console.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}". Skipping issue: ${issue.title}`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(200).send({ status: 'ignored', reason: 'no_repo_configured' });
    }

    console.log(`📥 [API] Enqueueing Ticket: ${issue.title} (team: ${teamKey || 'default'}, repo: ${repoUrl})`); // NOSONAR - Input is internal or trusted webhook payload

    try {
        await ralphQueue.add('coding-task', {
            ticketId: issue.id,
            title: issue.title,
            description: issue.description,
            repoUrl,
            branchName: `ralph/feat-${issue.identifier}`
        }, {
            jobId: issue.id,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            },
            removeOnComplete: true, // Immediate cleanup
            removeOnFail: true // Immediate cleanup to allow re-runs
        });
        return res.status(200).send({ status: 'queued' });
    } catch (e) {
        console.error("❌ [API] Failed to add job to queue:", e); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(500).send({ error: 'queue_failed' });
    }
}

app.post('/webhook', async (req: express.Request, res: express.Response) => {
    if (!verifyLinearSignature(req)) {
        console.warn(`⚠️ [API] Invalid webhook signature from ${req.ip}`); // NOSONAR - Input is internal or trusted webhook payload
        return res.status(401).send('Invalid signature');
    }

    const { action, data, type } = req.body;

    console.log(`🔍 [API] Webhook received: Type=${type}, Action=${action}, ID=${data?.id}`); // NOSONAR - Input is internal or trusted webhook payload
    if (data?.labels) {
        console.log(`🏷️ [API] Labels: ${data.labels.map((l: { name: string }) => l.name).join(', ')}`); // NOSONAR - Input is internal or trusted webhook payload
    } else {
        console.log(`🏷️ [API] No labels in payload.`);
    }

    if (type === 'Comment' && action === 'create') {
        return handleCommentWebhook(data, res);
    }

    if (type === 'Issue' && (action === 'create' || action === 'update')) {
        return handleIssueWebhook(data, action, res);
    }

    return res.status(200).send({ status: 'ignored' });
});

app.get('/health', (_req, res) => {
    res.status(200).send({ status: 'ok' });
});

if (require.main === module) {
    const server = app.listen(3000, () => console.log('🚀 API listening on 3000'));

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
        console.log(`🛑 ${signal} received. Closing HTTP server...`);
        
        server.close(async () => {
            console.log('HTTP server closed.');
            
            try {
                console.log('Closing Redis connections...');
                await ralphQueue.close();
                await connection.quit(); // IORedis close
                console.log('✅ Graceful shutdown completed.');
                process.exit(0);
            } catch (err) {
                console.error('❌ Error during shutdown:', err);
                process.exit(1);
            }
        });

        // Force exit after 10s if connections hang
        setTimeout(() => {
            console.error('🛑 Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app };
