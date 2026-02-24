# Task 008: Create Webhook DTO Models

## Objective
Create typed Data Transfer Objects for Linear webhook payloads using Ts.ED decorators. These replace manual `req.body` parsing with validated, documented models.

## Prerequisites
- 001 (Ts.ED dependencies installed)
- 002 (directory structure exists)

## Reference Files
- `src/server.ts` lines 307-349 (handleCommentWebhook - payload shape)
- `src/server.ts` lines 359-416 (handleIssueWebhook - payload shape)
- `src/server.ts` lines 418-441 (webhook route - type/action/data)
- `tests/fixtures/webhook-payloads.ts` (sample payloads for tests)

## Deliverables
- `src/models/enums/WebhookAction.ts`
- `src/models/payloads/IssueWebhookPayload.ts`
- `src/models/payloads/CommentWebhookPayload.ts`
- `src/models/payloads/WebhookEnvelope.ts`

## Instructions

### 1. Create `src/models/enums/WebhookAction.ts`

```typescript
export enum WebhookAction {
    CREATE = "create",
    UPDATE = "update",
    REMOVE = "remove",
}

export enum WebhookType {
    ISSUE = "Issue",
    COMMENT = "Comment",
}
```

### 2. Create `src/models/payloads/IssueWebhookPayload.ts`

Based on actual Linear webhook payload structure observed in server.ts:

```typescript
import { Property, Required, Optional, CollectionOf } from "@tsed/schema";

class LabelDto {
    @Property()
    name!: string;
}

class StateDto {
    @Property()
    name?: string;

    @Property()
    label?: string;
}

class TeamDto {
    @Property()
    key?: string;
}

export class IssueWebhookPayload {
    @Required()
    id!: string;

    @Property()
    identifier?: string;

    @Required()
    title!: string;

    @Property()
    description?: string;

    @Property()
    stateId?: string;

    @Property()
    state?: StateDto;

    @Property()
    team?: TeamDto;

    @CollectionOf(LabelDto)
    labels?: LabelDto[];
}
```

### 3. Create `src/models/payloads/CommentWebhookPayload.ts`

Based on actual payload structure in handleCommentWebhook:

```typescript
import { Property, Required, Optional } from "@tsed/schema";

class CommentUserDto {
    @Property()
    name?: string;

    @Property()
    displayName?: string;
}

class CommentIssueStateDto {
    @Property()
    name?: string;
}

class CommentIssueTeamDto {
    @Property()
    key?: string;
}

class CommentIssueDto {
    @Property()
    id?: string;

    @Property()
    identifier?: string;

    @Property()
    title?: string;

    @Property()
    description?: string;

    @Property()
    state?: CommentIssueStateDto;

    @Property()
    team?: CommentIssueTeamDto;
}

export class CommentWebhookPayload {
    @Property()
    body?: string;

    @Property()
    user?: CommentUserDto;

    @Property()
    issue?: CommentIssueDto;
}
```

### 4. Create `src/models/payloads/WebhookEnvelope.ts`

The top-level webhook structure:

```typescript
import { Property, Required } from "@tsed/schema";

export class WebhookEnvelope {
    @Required()
    action!: string;

    @Required()
    type!: string;

    @Property()
    data?: any; // Will be deserialized to specific DTO based on type
}
```

### Important Notes

- Use `@Property()` and `@Required()` for Swagger documentation, but **do NOT enable strict validation** that would reject extra fields. Linear payloads contain many more fields than we use, and strict validation would break the webhook.
- The `data` field in `WebhookEnvelope` is typed as `any` because its shape depends on `type` (Issue vs Comment). Deserialization to specific DTOs happens in the controller logic.
- All nested classes (`LabelDto`, `StateDto`, etc.) are co-located with their parent DTO for simplicity.

## Acceptance Criteria
- [ ] All four DTO files created in correct paths
- [ ] DTOs use `@Property()` and `@Required()` decorators
- [ ] Field names match actual Linear webhook payload structure
- [ ] `WebhookEnvelope` captures the top-level action/type/data structure
- [ ] `npm run build` compiles without errors
