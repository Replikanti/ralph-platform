import { logger } from '../infra/logger';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Langfuse } from 'langfuse';
import { startBamlProxy } from '../infra/baml-proxy';
import { runAgent, RateLimitError } from '../agent/agent';
import { storePlan, deletePlan, StoredPlan } from '../infra/plan-store';
import { formatPlanForLinear } from '../infra/plan-formatter';
import { LinearClient as RalphLinearClient } from '../infra/linear-client';
import { resolvePlatformAction } from '../domain/agent-outcomes';
import type { Task, AgentResult } from '../domain/types';
import type { ITracer } from '../domain/tracer-contract';
import { redactText } from '../security/redactor';
import { initAccountPool, accountPool } from '../infra/account-pool';
import { killActiveProcesses } from '../infra/claude-runner';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

// --- Langfuse tracer factory (platform concern, not agent concern) ---

function createLangfuseTracer(): ITracer {
    const lf = new Langfuse();
    return {
        span: async <T>(name: string, metadata: Record<string, unknown>, fn: () => Promise<T>): Promise<T> => {
            const trace = lf.trace({ name, metadata });
            try {
                return await fn();
            } catch (e: any) {
                trace.update({ metadata: { error: e.message } });
                throw e;
            } finally {
                await lf.flushAsync();
            }
        }
    };
}

// --- Platform helpers (Linear + Redis orchestration) ---

async function updateLinearIssue(issueId: string, statusName: string, comment?: string): Promise<void> {
    if (!process.env.LINEAR_API_KEY) return;
    try {
        const linearClient = new RalphLinearClient();
        await linearClient.updateIssueState(issueId, statusName);
        if (comment) await linearClient.postComment(issueId, comment);
    } catch (e: any) {
        logger.error("Linear update failed: " + await redactText(e.message ?? ''));
    }
}

async function notifyLinearJobStarted(task: Task): Promise<void> {
    if (!process.env.LINEAR_API_KEY) return;
    try {
        const linearClient = new RalphLinearClient();
        const { ticketId, jobId, mode, isIteration } = task;

        if (mode === 'plan-only') {
            await linearClient.updateIssueState(ticketId, "In Progress");
            const msg = isIteration
                ? `🔄 Ralph is creating iteration plan based on your feedback...\n\n📋 **Job ID:** \`${jobId}\``
                : `🤖 Ralph is generating implementation plan...\n\n📋 **Job ID:** \`${jobId}\``;
            await linearClient.postComment(ticketId, msg);
        } else if (mode === 'execute-only') {
            await updateLinearIssue(ticketId, "In Progress", `🤖 Ralph is executing approved plan...\n\n📋 **Job ID:** \`${jobId}\``);
        } else {
            await updateLinearIssue(ticketId, "In Progress", `🤖 Ralph started working\n\n📋 **Job ID:** \`${jobId}\``);
        }
    } catch (e: any) {
        logger.error("Failed to notify Linear of job start: " + await redactText(e.message ?? ''));
    }
}

async function handleAgentResult(result: AgentResult, task: Task, redis: IORedis): Promise<void> {
    const action = resolvePlatformAction(result);
    const linearClient = new RalphLinearClient();
    const { ticketId } = task;

    if (action.type === 'store-plan-and-notify') {
        const storedPlan: StoredPlan = {
            taskId: ticketId,
            plan: action.plan,
            taskContext: {
                ticketId,
                title: task.title,
                description: task.description,
                repoUrl: task.repoUrl,
                branchName: task.branchName,
                isIteration: task.isIteration,
            },
            feedbackHistory: task.additionalFeedback ? [task.additionalFeedback] : [],
            createdAt: new Date(),
            status: 'pending-review',
        };
        await storePlan(redis, ticketId, storedPlan);
        const formattedPlan = formatPlanForLinear(action.plan, task.title);
        try {
            await linearClient.postComment(ticketId, formattedPlan);
            await linearClient.updateIssueState(ticketId, "Todo");
        } catch (e) {
            logger.error({ err: e }, `❌ [Worker] Failed to notify Linear of plan for ${ticketId} — plan is stored in Redis, retry will re-post`);
        }
        logger.info("✅ Plan posted to Linear, awaiting human approval");
        return;
    }

    if (action.type === 'mark-in-review') {
        if (action.isIteration) {
            await updateLinearIssue(ticketId, "In Review", "✅ Iteration complete. Changes pushed to existing PR.");
        } else {
            logger.info("⏳ Waiting 3 seconds for Linear auto-switch to In Review...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            const currentState = await linearClient.getIssueState(ticketId);
            if (currentState?.toLowerCase() === 'in review') {
                logger.info("✅ Linear auto-switched to In Review, just adding comment");
                await linearClient.postComment(ticketId, "✅ Done. PR: " + action.prUrl);
            } else {
                logger.info(`📊 Linear didn't auto-switch (current: ${currentState}), manually updating to In Review`);
                await updateLinearIssue(ticketId, "In Review", "✅ Done. PR: " + action.prUrl);
            }
            await deletePlan(redis, ticketId);
        }
        return;
    }

    if (action.type === 'mark-todo-no-changes') {
        await updateLinearIssue(ticketId, "Todo", "⚠️ No changes necessary.");
        return;
    }

    const safeOutput = await redactText(action.validationOutput.substring(0, 1000));
    const failComment = `❌ Execution completed but validation failed.\n\n${action.summary}\n\n\`\`\`\n${safeOutput}\n\`\`\``;
    await updateLinearIssue(ticketId, "Todo", failComment);
}

// --- Job processor ---

export const jobProcessor = async (job: Job) => {
    logger.info(`🔨 [Worker] Processing ${job.id} (mode: ${job.data.mode || 'full'})`);

    const taskData: Task = {
        ...job.data,
        jobId: job.id as string,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 1,
        mode: job.data.mode || 'full',
        existingPlan: job.data.existingPlan,
        additionalFeedback: job.data.additionalFeedback,
    };

    await notifyLinearJobStarted(taskData);

    let result: AgentResult;
    const tracer = createLangfuseTracer();
    try {
        result = await runAgent(taskData, tracer);
    } catch (e: any) {
        if (e instanceof RateLimitError || e.name === 'RateLimitError') {
            const rateLimitErr = e as RateLimitError;
            try {
                const currentAccountPath = await accountPool.getCredentialsDir();
                await accountPool.markRateLimited(currentAccountPath, rateLimitErr.retryAfterMs);

                if (await accountPool.hasAvailableAccount()) {
                    logger.info(`🔄 [Worker] Rate limit hit — rotating to next account, immediate retry for job ${job.id}`);
                    await job.retry();
                    return;
                }
            } catch {
                // accountPool not configured or other error — fall through to delay
            }

            const delayMs = rateLimitErr.retryAfterMs ?? 60000;
            logger.warn(`⏳ [Worker] All accounts rate-limited for job ${job.id}. Backing off for ${delayMs}ms...`);
            await job.moveToDelayed(Date.now() + delayMs, job.token);
            return;
        }
        throw e;
    }

    await handleAgentResult(result, taskData, redisConnection);
};

// --- Worker setup ---

export const createWorker = () => {
    const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    logger.info("👷 Ralph Worker Started");

    const worker = new Worker('ralph-tasks', jobProcessor, {
        connection,
        concurrency: 1,
        limiter: {
            max: 10,
            duration: 60000
        },
        lockDuration: 600000,
        lockRenewTime: 30000,
    });

    worker.on('completed', async (job) => {
        logger.info(`✅ [Worker] Job ${job.id} completed! Ticket: ${job.data.ticketId}`);

        if (job.data.mode === 'execute-only' || job.data.mode === 'full') {
            const tombstoneKey = `ralph:tombstone:${job.data.ticketId}`;
            await connection.set(tombstoneKey, 'true', 'EX', 31536000);
            logger.info(`🪦 [Worker] Tombstone set for ticket ${job.data.ticketId}`);
        }
    });

    worker.on('failed', async (job, err) => {
        if (job) {
            const safeMsg = await redactText(err.message ?? '');
            logger.error(`❌ [Worker] Job ${job.id} failed (Attempt ${job.attemptsMade}/${job.opts.attempts}): ${safeMsg}`);

            if (job.attemptsMade >= (job.opts.attempts || 1)) {
                logger.error(`💀 [Worker] Job ${job.id} FAILED PERMANENTLY. Reporting to Linear...`);
                try {
                    await updateLinearIssue(
                        job.data.ticketId,
                        "Todo",
                        `💀 Critical System Failure\n\nThe task failed permanently after ${job.attemptsMade} attempts.\n\nError: ${safeMsg}`
                    );
                } catch (e) {
                    logger.error({ err: e }, "⚠️ Failed to report permanent failure to Linear");
                }
            }
        }
    });

    const shutdown = async (signal: string) => {
        logger.info(`🛑 ${signal} received. Shutting down worker...`);
        killActiveProcesses();
        try {
            await worker.close();
            await connection.quit();
            logger.info('✅ Worker shut down gracefully.');
            process.exit(0);
        } catch (err) {
            logger.error({ err }, '❌ Error during worker shutdown');
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return worker;
};

if (require.main === module) {
    const proxyPort = Number.parseInt(process.env.BAML_PROXY_PORT ?? '3001');
    process.env.BAML_PROXY_URL = process.env.BAML_PROXY_URL ?? `http://localhost:${proxyPort}/v1`;

    // Initialize account pool before starting the BAML proxy (proxy uses it for credential seeding)
    initAccountPool(
        process.env.CLAUDE_ACCOUNTS_DIR ?? '/claude-accounts',
        redisConnection,
    );

    await startBamlProxy(proxyPort);
    createWorker();
}
