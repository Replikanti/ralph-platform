import { LinearClient as LinearSDK } from "@linear/sdk";
import { findTargetState } from "./linear-utils";

export class LinearClient {
    private client: LinearSDK | null = null;

    constructor() {
        const apiKey = process.env.LINEAR_API_KEY;
        if (apiKey) {
            this.client = new LinearSDK({ apiKey });
        }
    }

    isEnabled(): boolean {
        return this.client !== null;
    }

    async postComment(issueId: string, body: string): Promise<void> {
        if (!this.client) {
            console.warn("⚠️ LINEAR_API_KEY not set, skipping comment post");
            return;
        }

        try {
            await this.client.createComment({ issueId, body });
            console.log(`💬 Posted comment to Linear issue ${issueId}`);
        } catch (e: any) {
            console.error(`❌ Failed to post comment to Linear: ${e.message}`);
            throw e;
        }
    }

    async updateIssueState(issueId: string, stateName: string): Promise<boolean> {
        if (!this.client) {
            console.warn("⚠️ LINEAR_API_KEY not set, skipping state update");
            return false;
        }

        try {
            const issue = await this.client.issue(issueId);
            const team = await issue.team;
            if (!team) {
                console.warn(`⚠️ No team found for issue ${issueId}`);
                return false;
            }

            let targetState = await findTargetState(team, stateName);

            // Fallback mechanism for missing plan-review state
            if (!targetState && stateName.toLowerCase() === 'plan-review') {
                console.warn(`⚠️ State "plan-review" not found in Linear workspace`);
                console.warn(`   💡 TIP: Create a "Plan Review" state in Linear Settings → Workflow → States`);
                console.warn(`   🔄 Falling back to "In Review" state...`);

                targetState = await findTargetState(team, 'in review');
                if (!targetState) {
                    console.error(`❌ Fallback state "In Review" also not found! Cannot update issue state.`);
                    console.error(`   Please create either "Plan Review" or "In Review" state in your Linear workspace.`);
                    return false;
                }
            } else if (!targetState) {
                console.warn(`⚠️ State "${stateName}" not found for issue ${issueId}`);
                return false;
            }

            const currentState = await issue.state;
            if (currentState?.id !== targetState.id) {
                await this.client.updateIssue(issueId, { stateId: targetState.id });
                console.log(`📊 Updated Linear issue ${issueId} to state: ${targetState.name}`);
                return true;
            }

            return true;
        } catch (e: any) {
            console.error(`❌ Failed to update Linear state: ${e.message}`);
            return false;
        }
    }

    async getIssueState(issueId: string): Promise<string | null> {
        if (!this.client) {
            console.warn("⚠️ LINEAR_API_KEY not set");
            return null;
        }

        try {
            const issue = await this.client.issue(issueId);
            const state = await issue.state;
            return state?.name || null;
        } catch (e: any) {
            console.error(`❌ Failed to get issue state: ${e.message}`);
            return null;
        }
    }

}
