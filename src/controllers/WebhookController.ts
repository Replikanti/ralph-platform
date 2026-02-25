import { Controller, Post, Req, Res, UseBefore } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { Inject } from "@tsed/di";
import express from "express";
import { SignatureVerificationMiddleware } from "../middlewares/SignatureVerificationMiddleware";
import { QueueService } from "../services/QueueService";
import { ConfigService } from "../services/ConfigService";
import { PlanStoreService } from "../services/PlanStoreService";
import { LinearClientService } from "../services/LinearClientService";
import { RedisProvider } from "../services/RedisProvider";

@Controller("/webhook")
@UseBefore(SignatureVerificationMiddleware)
export class WebhookController {
    private logger = new Logger("WebhookController");

    @Inject() private queue!: QueueService;
    @Inject() private config!: ConfigService;
    @Inject() private planStore!: PlanStoreService;
    @Inject() private linear!: LinearClientService;
    @Inject() private redis!: RedisProvider;

    @Post("/")
    async handleWebhook(@Req() req: express.Request, @Res() res: express.Response) {
        const { action, data, type } = req.body;

        this.logger.info(`Webhook received: Type=${type}, Action=${action}, ID=${data?.id}`);

        if (type === "Comment" && action === "create") {
            return this.handleComment(data, res);
        }

        if (type === "Issue" && (action === "create" || action === "update")) {
            return this.handleIssue(data, action, res);
        }

        return res.status(200).send({ status: "ignored" });
    }

    // --- Issue Handling ---

    private async handleIssue(data: any, action: string, res: express.Response) {
        // Tombstone check: prevent re-processing completed issues
        const tombstone = await this.redis.connection.get(`ralph:tombstone:${data.id}`);
        if (tombstone) {
            this.logger.info(`Ignoring ticket ${data.identifier} - Tombstone found`);
            return res.status(200).send({ status: "ignored", reason: "tombstone_present" });
        }

        // Label check
        const labels = data.labels || [];
        const labelNames = labels.map((l: { name: string }) => l.name);
        const hasRalphLabel = labelNames.some((name: string) => name.toLowerCase() === "ralph");

        if (!hasRalphLabel) {
            this.logger.info(`Skipping ticket ${data.identifier} - Ralph label not present`);
            return res.status(200).send({ status: "ignored", reason: "no_ralph_label" });
        }

        // Terminal state check
        const statusName = (data.state?.name || data.state?.label || "").toLowerCase();
        if (action === "update" && this.isTerminalState(statusName)) {
            this.logger.info(`Skipping ticket ${data.identifier} - Already in terminal state: ${statusName}`);
            return res.status(200).send({ status: "ignored", reason: "already_processed" });
        }

        // Resolve repository
        const teamKey = data.team?.key;
        const repoUrl = await this.config.getRepoForTeam(teamKey);

        if (!repoUrl) {
            this.logger.warn(`No repository configured for team "${teamKey || "unknown"}"`);
            return res.status(200).send({ status: "ignored", reason: "no_repo_configured" });
        }

        // Enqueue
        try {
            const result = await this.queue.enqueueIssue({
                ticketId: data.id,
                title: data.title,
                description: data.description,
                repoUrl,
                branchName: `ralph/feat-${data.identifier}`,
            });
            return res.status(200).send({ status: "queued", jobId: result.jobId });
        } catch (e: any) {
            this.logger.error("Failed to enqueue issue job:", e.message);
            return res.status(500).send({ error: "queue_failed" });
        }
    }

    // --- Comment Handling ---

    private async handleComment(data: any, res: express.Response) {
        const issue = data.issue;
        const commentBody = data.body || "";
        const issueState = issue?.state?.name || "";
        const commentAuthor = data.user?.name || data.user?.displayName || "";
        const issueId = issue?.id;

        if (!issueId) {
            return res.status(400).send({ error: "missing_issue_id" });
        }

        // CRITICAL: Ignore Ralph's own comments to prevent auto-execution
        if (this.isRalphComment(commentAuthor, commentBody)) {
            this.logger.info("Ignoring Ralph's own comment (prevents auto-execution)");
            return res.status(200).send({ status: "ignored", reason: "ralph_comment" });
        }

        // Check for stored plan
        const storedPlan = await this.planStore.getPlan(issueId);
        if (storedPlan) {
            return this.handleStoredPlanComment(issueId, issueState, storedPlan, commentBody, res);
        }

        // Check for PR iteration (in review state, no stored plan)
        const inReviewState = issueState.toLowerCase().includes("review");
        if (inReviewState) {
            return this.handleIterationRequest(issueId, issue, commentBody, res);
        }

        this.logger.info("Skipping comment - no stored plan and not in review state");
        return res.status(200).send({ status: "ignored", reason: "no_stored_plan" });
    }

    private async handleStoredPlanComment(
        issueId: string,
        issueState: string,
        storedPlan: any,
        commentBody: string,
        res: express.Response
    ) {
        const normalizedState = issueState.toLowerCase();
        const isProcessing = normalizedState === "in progress" || normalizedState === "in review";

        if (this.isApprovalComment(commentBody) && isProcessing) {
            this.logger.info(`Ignoring approval for ${issueId} - already in active state: ${issueState}`);
            return res.status(200).send({ status: "ignored", reason: "already_processed" });
        }

        // Move ticket back to In Progress
        await this.linear.updateIssueState(issueId, "In Progress");

        if (this.isApprovalComment(commentBody)) {
            return this.handlePlanApproval(issueId, storedPlan, res);
        }
        return this.handlePlanRevision(issueId, storedPlan, commentBody, res);
    }

    private async handlePlanApproval(issueId: string, storedPlan: any, res: express.Response) {
        this.logger.info(`Plan approved for issue ${issueId}`);

        try {
            const result = await this.queue.enqueueExecution({
                ticketId: issueId,
                title: storedPlan.taskContext.title,
                description: storedPlan.taskContext.description,
                repoUrl: storedPlan.taskContext.repoUrl,
                branchName: storedPlan.taskContext.branchName,
                mode: "execute-only",
                existingPlan: storedPlan.plan,
                isIteration: storedPlan.taskContext.isIteration,
            });
            return res.status(200).send({ status: "execution_queued", jobId: result.jobId });
        } catch (e: any) {
            this.logger.error("Failed to enqueue execution:", e.message);
            return res.status(500).send({ error: "queue_failed" });
        }
    }

    private async handlePlanRevision(issueId: string, storedPlan: any, commentBody: string, res: express.Response) {
        this.logger.info(`Revision feedback for issue ${issueId}`);

        try {
            const result = await this.queue.enqueueReplanning({
                ticketId: issueId,
                title: storedPlan.taskContext.title,
                description: storedPlan.taskContext.description,
                repoUrl: storedPlan.taskContext.repoUrl,
                branchName: storedPlan.taskContext.branchName,
                mode: "plan-only",
                additionalFeedback: commentBody,
            });
            return res.status(200).send({ status: "replanning_queued", jobId: result.jobId });
        } catch (e: any) {
            this.logger.error("Failed to enqueue replanning:", e.message);
            return res.status(500).send({ error: "queue_failed" });
        }
    }

    private async handleIterationRequest(issueId: string, issue: any, commentBody: string, res: express.Response) {
        this.logger.info("PR iteration detected - creating plan for iterative fixes");

        const teamKey = issue?.team?.key;
        const repoUrl = await this.config.getRepoForTeam(teamKey);

        if (!repoUrl) {
            this.logger.warn(`No repository configured for team "${teamKey || "unknown"}"`);
            return res.status(200).send({ status: "ignored", reason: "no_repo_configured" });
        }

        try {
            const result = await this.queue.enqueueIteration({
                ticketId: issueId,
                title: issue?.title || "Iterative fix",
                description: issue?.description || commentBody,
                repoUrl,
                branchName: `ralph/feat-${issue?.identifier || issueId}`,
                mode: "plan-only",
                additionalFeedback: commentBody,
                isIteration: true,
            });
            return res.status(200).send({ status: "iteration_queued", jobId: result.jobId });
        } catch (e: any) {
            this.logger.error("Failed to enqueue iteration:", e.message);
            return res.status(500).send({ error: "queue_failed" });
        }
    }

    // --- Helpers (pure logic, no I/O) ---

    private isApprovalComment(body: string): boolean {
        const patterns = [/\blgtm\b/i, /\bapproved\b/i, /\bproceed\b/i, /\bship it\b/i];
        return patterns.some((p) => p.test(body));
    }

    private isRalphComment(author: string, body: string): boolean {
        return (
            author.toLowerCase().includes("ralph") ||
            author.toLowerCase().includes("bot") ||
            body.includes("Ralph") ||
            body.includes("Ralph's Implementation Plan")
        );
    }

    private isTerminalState(state: string): boolean {
        const terminal = ["in progress", "in review", "completed", "canceled", "done"];
        return terminal.includes(state);
    }
}
