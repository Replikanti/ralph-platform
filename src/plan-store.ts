import IORedis from 'ioredis';
import { StoredPlan } from './agent';

const PLAN_TTL_DAYS = Number.parseInt(process.env.PLAN_TTL_DAYS || '7', 10);
const PLAN_TTL_SECONDS = PLAN_TTL_DAYS * 24 * 60 * 60;

function getPlanKey(taskId: string): string {
    return `ralph:plan:${taskId}`;
}

export async function storePlan(redis: IORedis, taskId: string, plan: StoredPlan): Promise<void> {
    const key = getPlanKey(taskId);
    await redis.set(key, JSON.stringify(plan), 'EX', PLAN_TTL_SECONDS);
    console.log(`📝 Stored plan for task ${taskId} (TTL: ${PLAN_TTL_DAYS} days)`);
}

export async function getPlan(redis: IORedis, taskId: string): Promise<StoredPlan | null> {
    const key = getPlanKey(taskId);
    const data = await redis.get(key);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    // Convert ISO date string back to Date object
    parsed.createdAt = new Date(parsed.createdAt);
    return parsed as StoredPlan;
}

export async function updatePlanStatus(redis: IORedis, taskId: string, status: StoredPlan['status']): Promise<void> {
    const plan = await getPlan(redis, taskId);
    if (!plan) {
        console.warn(`⚠️ Cannot update status: plan ${taskId} not found`);
        return;
    }
    
    plan.status = status;
    await storePlan(redis, taskId, plan);
    console.log(`📊 Updated plan ${taskId} status to: ${status}`);
}

export async function appendFeedback(redis: IORedis, taskId: string, feedback: string): Promise<void> {
    const plan = await getPlan(redis, taskId);
    if (!plan) {
        console.warn(`⚠️ Cannot append feedback: plan ${taskId} not found`);
        return;
    }
    
    plan.feedbackHistory.push(feedback);
    plan.status = 'needs-revision';
    await storePlan(redis, taskId, plan);
    console.log(`💬 Appended feedback to plan ${taskId}`);
}

export async function deletePlan(redis: IORedis, taskId: string): Promise<void> {
    const key = getPlanKey(taskId);
    await redis.del(key);
    console.log(`🗑️ Deleted plan ${taskId}`);
}
