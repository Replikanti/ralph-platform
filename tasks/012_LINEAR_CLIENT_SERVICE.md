# Task 012: Create LinearClientService

## Objective
Wrap the Linear SDK client in an injectable Ts.ED service, replacing the `LinearClient` class in `src/linear-client.ts` and the `updateLinearIssue` helper in `src/agent.ts`.

## Prerequisites
- 003 (env config with `LINEAR_API_KEY`)
- 006 (domain/LinearUtils.ts exists)

## Reference Files
- `src/linear-client.ts` (96 lines - complete file)
- `src/agent.ts` lines 60-76 (`updateLinearIssue` helper)
- `src/domain/LinearUtils.ts` (state synonym mapping)

## Deliverables
- `src/services/LinearClientService.ts`

## Instructions

```typescript
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
```

### Key Design Decisions

1. **Exact same logic** as `linear-client.ts`, plus the `updateLinearIssue` helper from `agent.ts` merged as `updateIssueWithComment`.
2. **Constructor initialization**: Linear SDK client created in constructor (not `$onInit`), matching current pattern where it's created synchronously.
3. **Graceful degradation**: When `LINEAR_API_KEY` is not set, all methods log warnings and return safely.
4. **Uses domain/LinearUtils.ts** for state synonym mapping - domain function called from service.
5. **Plan-review fallback**: The special fallback from "plan-review" → "in review" state is preserved.

## Acceptance Criteria
- [ ] `src/services/LinearClientService.ts` exists with `@Service()` decorator
- [ ] All three original methods preserved: `postComment`, `updateIssueState`, `getIssueState`
- [ ] New `updateIssueWithComment` method replaces `updateLinearIssue` from agent.ts
- [ ] Uses `findTargetState` from `domain/LinearUtils.ts`
- [ ] Gracefully handles missing `LINEAR_API_KEY`
- [ ] Plan-review → in review fallback preserved
- [ ] `npm run build` compiles without errors
