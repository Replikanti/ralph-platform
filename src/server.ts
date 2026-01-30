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
import { getPlan } from './plan-store';

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

function isApprovalComment(body: string): boolean {
    const approvalPatterns = [/\blgtm\b/i, /\bapproved\b/i, /\bproceed\b/i, /\bship it\b/i];
    return approvalPatterns.some(pattern => pattern.test(body));
}

function isStateInPlanReview(stateName: string): boolean {
    const normalized = stateName.toLowerCase().trim();
    const planReviewSynonyms = ['plan-review', 'plan review', 'pending review', 'awaiting approval'];
    return planReviewSynonyms.includes(normalized);
}

interface JobConfig {
    jobId: string;
    jobData: any;
    logContext: { type: string; details: string[] };
}

async function enqueueJob(config: JobConfig, res: express.Response): Promise<express.Response> {
    const { jobId, jobData, logContext } = config;

    try {
        console.log(`📥 [API] Adding ${logContext.type} job to queue:`);
        console.log(`   Job ID: ${jobId}`);
        logContext.details.forEach(detail => console.log(`   ${detail}`));

        await ralphQueue.add('coding-task', jobData, {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 }
        });

        console.log(`✅ [API] Successfully enqueued ${logContext.type} job ${jobId}`);
        return res.status(200).send({ status: `${logContext.type}_queued`, jobId });
    } catch (e) {
        console.error(`❌ [API] Failed to enqueue ${logContext.type} job:`, e);
        return res.status(500).send({ error: 'queue_failed' });
    }
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

    // Handle Comment Events (Plan Review Approvals/Feedback)
    if (type === 'Comment' && action === 'create') {
        const issue = data.issue;
        const commentBody = data.body || '';
        const issueState = issue?.state?.name || '';

        console.log(`💬 [API] Comment received:`);
        console.log(`   Issue ID: ${issue?.id}`);
        console.log(`   Issue State: "${issueState}"`);
        console.log(`   Comment Body: "${commentBody.substring(0, 100)}..."`);

        const issueId = issue?.id;
        if (!issueId) {
            console.warn(`⚠️ [API] Comment event missing issue ID`);
            return res.status(400).send({ error: 'missing_issue_id' });
        }

        // Retrieve stored plan to check if we're in plan review mode
        const storedPlan = await getPlan(connection, issueId);
        if (storedPlan) {
            // If we have a stored plan, we're in plan review regardless of state
            // But also check state as a sanity check
            const inPlanReviewState = isStateInPlanReview(issueState);
            if (!inPlanReviewState) {
                console.warn(`⚠️ [API] Issue ${issueId} has stored plan but is in "${issueState}" state (expected plan-review)`);
                console.warn(`   💡 This might indicate plan-review state is missing in Linear workspace`);
                console.warn(`   🔄 Processing comment anyway since stored plan exists...`);
            }

            // Check if comment is approval or feedback
        if (isApprovalComment(commentBody)) {
            console.log(`✅ [API] Plan approved for issue ${issueId}`);

            const jobId = `${issueId}-exec-${Date.now()}`;
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
        } else {
            console.log(`💭 [API] Revision feedback received for issue ${issueId}`);

            const jobId = `${issueId}-replan-${Date.now()}`;
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
        } else {
            // No stored plan - check if this is a PR iteration request
            const inReviewState = issueState.toLowerCase().includes('review') || issueState.toLowerCase() === 'in review';

            if (inReviewState) {
                console.log(`🔄 [API] PR iteration detected - issue in review state without stored plan`);
                console.log(`   Creating new plan for iterative fixes...`);

                // Get issue details for iteration context
                const issueTitle = issue?.title || 'Iterative fix';
                const issueDescription = issue?.description || commentBody;
                const teamKey = issue?.team?.key;
                const identifier = issue?.identifier || issueId;

                const repoUrl = await getRepoForTeam(teamKey);
                if (!repoUrl) {
                    console.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}"`);
                    return res.status(200).send({ status: 'ignored', reason: 'no_repo_configured' });
                }

                const jobId = `${issueId}-iterate-${Date.now()}`;
                const jobData = {
                    ticketId: issueId,
                    title: issueTitle,
                    description: issueDescription,
                    repoUrl,
                    branchName: `ralph/feat-${identifier}`,
                    mode: 'plan-only',
                    additionalFeedback: commentBody,
                    isIteration: true // Flag to indicate this is PR iteration
                };

                return enqueueJob({
                    jobId,
                    jobData,
                    logContext: {
                        type: 'iteration',
                        details: [`Feedback: "${commentBody.substring(0, 100)}..."`]
                    }
                }, res);
            }

            // Not in review state and no stored plan - ignore
            console.log(`ℹ️ [API] Skipping comment - no stored plan and not in review state`);
            return res.status(200).send({ status: 'ignored', reason: 'no_stored_plan' });
        }
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
