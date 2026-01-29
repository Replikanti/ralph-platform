import { LinearClient as LinearSDK } from "@linear/sdk";

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

    async updateIssueState(issueId: string, stateName: string): Promise<void> {
        if (!this.client) {
            console.warn("⚠️ LINEAR_API_KEY not set, skipping state update");
            return;
        }

        try {
            const issue = await this.client.issue(issueId);
            const team = await issue.team;
            if (!team) {
                console.warn(`⚠️ No team found for issue ${issueId}`);
                return;
            }

            const targetState = await this.findTargetState(team, stateName);
            if (!targetState) {
                console.warn(`⚠️ State "${stateName}" not found for issue ${issueId}`);
                return;
            }

            const currentState = await issue.state;
            if (currentState?.id !== targetState.id) {
                await this.client.updateIssue(issueId, { stateId: targetState.id });
                console.log(`📊 Updated Linear issue ${issueId} to state: ${stateName}`);
            }
        } catch (e: any) {
            console.error(`❌ Failed to update Linear state: ${e.message}`);
            throw e;
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

    private async findTargetState(team: any, statusName: string) {
        const states = await team.states();
        const name = statusName.toLowerCase();
        
        let state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === name);
        if (state) return state;

        const synonymMap: Record<string, string[]> = {
            'todo': ['triage', 'backlog', 'todo', 'unstarted', 'ready'],
            'in review': ['in review', 'under review', 'peer review', 'review', 'pr'],
            'plan-review': ['plan-review', 'plan review', 'pending review', 'awaiting approval']
        };

        const synonyms = synonymMap[name];
        if (synonyms) {
            for (const syn of synonyms) {
                state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === syn);
                if (state) return state;
            }
        }

        return null;
    }
}
