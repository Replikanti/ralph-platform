import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import helmet from 'helmet';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getPlan } from '../infra/plan-store';
import { LinearClient as RalphLinearClient } from '../infra/linear-client';
import { parseIssuePayload, parseCommentPayload } from '../infra/webhook-schemas';
import { hasRalphLabel, shouldSkipIssueWebhook, routeComment } from '../domain/webhook-routing';
import { logger } from '../infra/logger';

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
    logger.info('🛡️ Admin dashboard enabled at /admin/queues');
} else {
    logger.warn('⚠️ ADMIN_USER or ADMIN_PASS not set. Dashboard is disabled.');
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
                logger.info("🔄 Configuration refreshed from ConfigMap");
            } catch (e) {
                logger.warn({ err: e }, "⚠️ Failed to refresh config from file, using Redis fallback");
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
        logger.warn({ err: e }, "⚠️ Error resolving repo config");
    }

    // 3. Fallback to Env Var (Legacy)
    try {
        const envMap = JSON.parse(process.env.LINEAR_TEAM_REPOS || '{}');
        if (teamKey && envMap[teamKey]) {
            return envMap[teamKey];
        }
    } catch (e) {
        logger.error({ err: e }, '❌ Invalid LINEAR_TEAM_REPOS JSON');
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
        logger.error("❌ LINEAR_WEBHOOK_SECRET is not set!");
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
        logger.info(`📥 [API] Adding ${logContext.type} job to queue:`);
        logger.info(`   Job ID: ${jobId}`);
        logContext.details.forEach(detail => logger.info(`   ${detail}`));

        await ralphQueue.add('coding-task', jobData, {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true, // Immediate cleanup to allow re-runs
            removeOnFail: true // Immediate cleanup to allow re-runs after failure
        });

        logger.info(`✅ [API] Successfully enqueued ${logContext.type} job ${jobId}`);
        return res.status(200).send({ status: `${logContext.type}_queued`, jobId });
    } catch (e) {
        logger.error({ err: e }, `❌ [API] Failed to enqueue ${logContext.type} job`);
        return res.status(500).send({ error: 'queue_failed' });
    }
}

async function handlePlanApproval(issueId: string, storedPlan: any, res: express.Response): Promise<express.Response> {
    logger.info(`✅ [API] Plan approved for issue ${issueId}`);

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
    logger.info(`💭 [API] Revision feedback received for issue ${issueId}`);

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
    logger.info(`🔄 [API] PR iteration detected - issue in review state without stored plan`);
    logger.info(`   Creating new plan for iterative fixes...`);

    const { issueId, issueTitle, issueDescription, teamKey, identifier, feedback } = routing;

    const repoUrl = await getRepoForTeam(teamKey);
    if (!repoUrl) {
        logger.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}"`);
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
        logger.warn(`⚠️ [API] Invalid comment payload: ${parsed.error}`);
        return res.status(400).send({ error: 'invalid_payload' });
    }

    const { comment } = parsed;
    const issueId = comment.issue?.id;

    if (!issueId) {
        logger.warn(`⚠️ [API] Comment event missing issue ID`);
        return res.status(400).send({ error: 'missing_issue_id' });
    }

    logger.info(`💬 [API] Comment received:`);
    logger.info(`   Issue ID: ${issueId}`);
    logger.info(`   Issue State: "${comment.issue?.state?.name ?? ''}"`);
    logger.info(`   Comment Author: "${comment.author.name ?? comment.author.displayName ?? ''}"`);
    logger.info(`   Comment Body: "${comment.body.substring(0, 100)}..."`);

    const storedPlan = await getPlan(connection, issueId);
    const routing = routeComment(comment, storedPlan);

    if (routing.action === 'ignore') {
        logger.info(`ℹ️ [API] Ignoring comment (${routing.reason})`);
        return res.status(200).send({ status: 'ignored', reason: routing.reason.replaceAll('-', '_') });
    }

    if (routing.action === 'approve' || routing.action === 'revise') {
        // Move ticket back to "In Progress" when user provides feedback/approval
        const linearClient = new RalphLinearClient();
        await linearClient.updateIssueState(issueId, "In Progress");
        logger.info(`📊 [API] Moved issue ${issueId} back to In Progress (user responded)`);
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
        logger.warn(`⚠️ [API] Invalid issue payload: ${parsed.error}`);
        return res.status(400).send({ error: 'invalid_payload' });
    }

    const { issue } = parsed;

    // Tombstone Check: Prevent Reopen
    const tombstone = await connection.get(`ralph:tombstone:${issue.id}`);
    if (tombstone) {
        logger.info(`🪦 [API] Ignoring ticket ${issue.identifier} (ID: ${issue.id}) - Tombstone found (already processed).`);
        return res.status(200).send({ status: 'ignored', reason: 'tombstone_present' });
    }

    if (!hasRalphLabel(issue)) {
        const labelNames = issue.labels.map(l => l.name);
        logger.info(`ℹ️ [API] Skipping ticket ${issue.identifier} - Ralph label not present. Current labels: ${labelNames.join(', ')}`);
        return res.status(200).send({ status: 'ignored', reason: 'no_ralph_label' });
    }

    const stateName = issue.state?.name ?? '';
    logger.info(`📊 [API] Ticket ${issue.identifier} current state: "${stateName}"`);

    if (shouldSkipIssueWebhook(action, stateName)) {
        logger.info(`ℹ️ [API] Skipping ticket ${issue.identifier} - Already in active/terminal state: ${stateName}`);
        return res.status(200).send({ status: 'ignored', reason: 'already_processed' });
    }

    const teamKey = issue.team?.key;
    const repoUrl = await getRepoForTeam(teamKey);

    if (!repoUrl) {
        logger.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}". Skipping issue: ${issue.title}`);
        return res.status(200).send({ status: 'ignored', reason: 'no_repo_configured' });
    }

    logger.info(`📥 [API] Enqueueing Ticket: ${issue.title} (team: ${teamKey || 'default'}, repo: ${repoUrl})`);

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
        logger.error({ err: e }, "❌ [API] Failed to add job to queue");
        return res.status(500).send({ error: 'queue_failed' });
    }
}

app.post('/webhook', async (req: express.Request, res: express.Response) => {
    if (!verifyLinearSignature(req)) {
        logger.warn(`⚠️ [API] Invalid webhook signature from ${req.ip}`);
        return res.status(401).send('Invalid signature');
    }

    const { action, data, type } = req.body;

    logger.info(`🔍 [API] Webhook received: Type=${type}, Action=${action}, ID=${data?.id}`);
    if (data?.labels) {
        logger.info(`🏷️ [API] Labels: ${data.labels.map((l: { name: string }) => l.name).join(', ')}`);
    } else {
        logger.info(`🏷️ [API] No labels in payload.`);
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
    const server = app.listen(3000, () => logger.info('🚀 API listening on 3000'));

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
        logger.info(`🛑 ${signal} received. Closing HTTP server...`);
        
        server.close(async () => {
            logger.info('HTTP server closed.');
            
            try {
                logger.info('Closing Redis connections...');
                await ralphQueue.close();
                await connection.quit(); // IORedis close
                logger.info('✅ Graceful shutdown completed.');
                process.exit(0);
            } catch (err) {
                logger.error({ err }, '❌ Error during shutdown');
                process.exit(1);
            }
        });

        // Force exit after 10s if connections hang
        setTimeout(() => {
            logger.error('🛑 Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app };
