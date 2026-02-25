import { Service, Inject } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { RedisProvider } from "./RedisProvider";
import { PLAN_TTL_DAYS } from "../config/env";

// Re-export StoredPlan interface for consumers
export interface StoredPlan {
    taskId: string;
    plan: string;
    taskContext: {
        ticketId: string;
        title: string;
        description?: string;
        repoUrl: string;
        branchName: string;
        isIteration?: boolean;
    };
    feedbackHistory: string[];
    createdAt: Date;
    status: "pending-review" | "approved" | "needs-revision";
}

const PLAN_TTL_SECONDS = PLAN_TTL_DAYS * 24 * 60 * 60;

@Service()
export class PlanStoreService {
    private logger = new Logger("PlanStoreService");

    @Inject()
    private redis!: RedisProvider;

    private getPlanKey(taskId: string): string {
        return `ralph:plan:${taskId}`;
    }

    async storePlan(taskId: string, plan: StoredPlan): Promise<void> {
        const key = this.getPlanKey(taskId);
        await this.redis.connection.set(key, JSON.stringify(plan), "EX", PLAN_TTL_SECONDS);
        this.logger.info(`Stored plan for task ${taskId} (TTL: ${PLAN_TTL_DAYS} days)`);
    }

    async getPlan(taskId: string): Promise<StoredPlan | null> {
        const key = this.getPlanKey(taskId);
        const data = await this.redis.connection.get(key);
        if (!data) return null;

        const parsed = JSON.parse(data);
        parsed.createdAt = new Date(parsed.createdAt);
        return parsed as StoredPlan;
    }

    async updatePlanStatus(taskId: string, status: StoredPlan["status"]): Promise<void> {
        const plan = await this.getPlan(taskId);
        if (!plan) {
            this.logger.warn(`Cannot update status: plan ${taskId} not found`);
            return;
        }
        plan.status = status;
        await this.storePlan(taskId, plan);
        this.logger.info(`Updated plan ${taskId} status to: ${status}`);
    }

    async appendFeedback(taskId: string, feedback: string): Promise<void> {
        const plan = await this.getPlan(taskId);
        if (!plan) {
            this.logger.warn(`Cannot append feedback: plan ${taskId} not found`);
            return;
        }
        plan.feedbackHistory.push(feedback);
        plan.status = "needs-revision";
        await this.storePlan(taskId, plan);
        this.logger.info(`Appended feedback to plan ${taskId}`);
    }

    async deletePlan(taskId: string): Promise<void> {
        const key = this.getPlanKey(taskId);
        await this.redis.connection.del(key);
        this.logger.info(`Deleted plan ${taskId}`);
    }
}
