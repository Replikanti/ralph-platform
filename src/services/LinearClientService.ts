import { Service } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { LinearClient as LinearSDK } from "@linear/sdk";
import { findTargetState } from "../domain/LinearUtils";
import { LINEAR_API_KEY } from "../config/env";

@Service()
export class LinearClientService {
    private readonly client: LinearSDK | null = null;
    private logger = new Logger("LinearClientService");

    constructor() {
        if (LINEAR_API_KEY) {
            this.client = new LinearSDK({ apiKey: LINEAR_API_KEY });
        } else {
            this.logger.warn("LINEAR_API_KEY not set - Linear features disabled");
        }
    }

    isEnabled(): boolean {
        return this.client !== null;
    }

    async postComment(issueId: string, body: string): Promise<void> {
        if (!this.client) {
            this.logger.warn("LINEAR_API_KEY not set, skipping comment post");
            return;
        }

        try {
            await this.client.createComment({ issueId, body });
            this.logger.info(`Posted comment to Linear issue ${issueId}`);
        } catch (e: any) {
            this.logger.error(`Failed to post comment to Linear: ${e.message}`);
            throw e;
        }
    }

    async updateIssueState(issueId: string, stateName: string): Promise<boolean> {
        if (!this.client) {
            this.logger.warn("LINEAR_API_KEY not set, skipping state update");
            return false;
        }

        try {
            const issue = await this.client.issue(issueId);
            const team = await issue.team;
            if (!team) {
                this.logger.warn(`No team found for issue ${issueId}`);
                return false;
            }

            let targetState = await findTargetState(team, stateName);

            // Fallback mechanism for missing plan-review state
            if (!targetState && stateName.toLowerCase() === "plan-review") {
                this.logger.warn('State "plan-review" not found. Falling back to "In Review"...');
                targetState = await findTargetState(team, "in review");
                if (!targetState) {
                    this.logger.error('Fallback state "In Review" also not found!');
                    return false;
                }
            } else if (!targetState) {
                this.logger.warn(`State "${stateName}" not found for issue ${issueId}`);
                return false;
            }

            const currentState = await issue.state;
            if (currentState?.id !== targetState.id) {
                await this.client.updateIssue(issueId, { stateId: targetState.id });
                this.logger.info(`Updated issue ${issueId} to state: ${targetState.name}`);
                return true;
            }

            return true;
        } catch (e: any) {
            this.logger.error(`Failed to update Linear state: ${e.message}`);
            return false;
        }
    }

    async getIssueState(issueId: string): Promise<string | null> {
        if (!this.client) {
            this.logger.warn("LINEAR_API_KEY not set");
            return null;
        }

        try {
            const issue = await this.client.issue(issueId);
            const state = await issue.state;
            return state?.name || null;
        } catch (e: any) {
            this.logger.error(`Failed to get issue state: ${e.message}`);
            return null;
        }
    }

    /**
     * Combined helper: update state and optionally post a comment.
     * Replaces the `updateLinearIssue()` function from agent.ts.
     */
    async updateIssueWithComment(issueId: string, stateName: string, comment?: string): Promise<void> {
        if (!this.isEnabled()) return;

        try {
            await this.updateIssueState(issueId, stateName);
            if (comment) {
                await this.postComment(issueId, comment);
            }
        } catch (e: any) {
            this.logger.error(`Linear update failed: ${e.message}`);
        }
    }
}
