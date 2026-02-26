import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent, RateLimitError, Task } from './agent';
import { storePlan, deletePlan, StoredPlan } from './plan-store';
import { formatPlanForLinear } from './plan-formatter';
import { LinearClient as RalphLinearClient } from './linear-client';
import { resolvePlatformAction } from './domain/agent-outcomes';
import type { AgentResult } from './domain/types';
import dotenv from 'dotenv';

dotenv.config();

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

// --- Platform helpers (Linear + Redis orchestration) ---

async function updateLinearIssue(issueId: string, statusName: string, comment?: string): Promise<void> {
    if (!process.env.LINEAR_API_KEY) return;
    try {
        const linearClient = new RalphLinearClient();
        await linearClient.updateIssueState(issueId, statusName);
        if (comment) await linearClient.postComment(issueId, comment);
    } catch (e: any) {
        console.error("Linear update failed: " + e.message);
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
        console.error("Failed to notify Linear of job start: " + e.message);
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
        await linearClient.postComment(ticketId, formattedPlan);
        await linearClient.updateIssueState(ticketId, "Todo");
        console.log("✅ Plan posted to Linear, awaiting human approval");
        return;
    }

    if (action.type === 'mark-in-review') {
        if (action.isIteration) {
            await updateLinearIssue(ticketId, "In Review", "✅ Iteration complete. Changes pushed to existing PR.");
        } else {
            console.log("⏳ Waiting 3 seconds for Linear auto-switch to In Review...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            const currentState = await linearClient.getIssueState(ticketId);
            if (currentState?.toLowerCase() === 'in review') {
                console.log("✅ Linear auto-switched to In Review, just adding comment");
                await linearClient.postComment(ticketId, "✅ Done. PR: " + action.prUrl);
            } else {
                console.log(`📊 Linear didn't auto-switch (current: ${currentState}), manually updating to In Review`);
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

    // mark-todo-failed
    const failComment = `❌ Execution completed but validation failed.\n\n${action.summary}\n\n\`\`\`\n${action.validationOutput.substring(0, 1000)}\n\`\`\``;
    await updateLinearIssue(ticketId, "Todo", failComment);
}

// --- Job processor ---

export const jobProcessor = async (job: Job) => {
    console.log(`🔨 [Worker] Processing ${job.id} (mode: ${job.data.mode || 'full'})`);

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
    try {
        result = await runAgent(taskData);
    } catch (e: any) {
        if (e.name === 'RateLimitError') {
            console.warn(`⏳ [Worker] Rate Limit hit for job ${job.id}. Backing off for 60s...`);
            await job.moveToDelayed(Date.now() + 60000, job.token);
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

    console.log("👷 Ralph Worker Started");

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
        console.log(`✅ [Worker] Job ${job.id} completed! Ticket: ${job.data.ticketId}`);

        if (job.data.mode === 'execute-only' || job.data.mode === 'full') {
            const tombstoneKey = `ralph:tombstone:${job.data.ticketId}`;
            await connection.set(tombstoneKey, 'true', 'EX', 31536000);
            console.log(`🪦 [Worker] Tombstone set for ticket ${job.data.ticketId}`);
        }
    });

    worker.on('failed', async (job, err) => {
        if (job) {
            console.error(`❌ [Worker] Job ${job.id} failed (Attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);

            if (job.attemptsMade >= (job.opts.attempts || 1)) {
                console.error(`💀 [Worker] Job ${job.id} FAILED PERMANENTLY. Reporting to Linear...`);
                try {
                    await updateLinearIssue(
                        job.data.ticketId,
                        "Todo",
                        `💀 Critical System Failure\n\nThe task failed permanently after ${job.attemptsMade} attempts.\n\nError: ${err.message}`
                    );
                } catch (e) {
                    console.error("⚠️ Failed to report permanent failure to Linear:", e);
                }
            }
        }
    });

    const shutdown = async (signal: string) => {
        console.log(`🛑 ${signal} received. Shutting down worker...`);
        try {
            await worker.close();
            await connection.quit();
            console.log('✅ Worker shut down gracefully.');
            process.exit(0);
        } catch (err) {
            console.error('❌ Error during worker shutdown:', err);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return worker;
};

if (require.main === module) {
    createWorker();
}
