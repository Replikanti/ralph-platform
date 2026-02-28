import { logger } from './logger';
import IORedis from 'ioredis';
import type { StoredPlanContext } from '../domain/types';

export interface StoredPlan extends StoredPlanContext {
    taskId: string;
    createdAt: Date;
    status: 'pending-review' | 'approved' | 'needs-revision';
}

const PLAN_TTL_DAYS = Number.parseInt(process.env.PLAN_TTL_DAYS || '7', 10);
const PLAN_TTL_SECONDS = PLAN_TTL_DAYS * 24 * 60 * 60;

function getPlanKey(taskId: string): string {
    return `ralph:plan:${taskId}`;
}

export async function storePlan(redis: IORedis, taskId: string, plan: StoredPlan): Promise<void> {
    const key = getPlanKey(taskId);
    await redis.set(key, JSON.stringify(plan), 'EX', PLAN_TTL_SECONDS);
    logger.info(`📝 Stored plan for task ${taskId} (TTL: ${PLAN_TTL_DAYS} days)`);
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

export async function deletePlan(redis: IORedis, taskId: string): Promise<void> {
    const key = getPlanKey(taskId);
    await redis.del(key);
    logger.info(`🗑️ Deleted plan ${taskId}`);
}
