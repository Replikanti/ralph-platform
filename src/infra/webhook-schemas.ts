import { z } from 'zod';
import type { WebhookIssue, WebhookComment } from '../domain/types';

const LabelSchema = z.object({ name: z.string() });
const StateSchema = z.object({
    name: z.string().optional(),
    label: z.string().optional(),
});
const TeamSchema = z.object({ key: z.string().optional() });
const UserSchema = z.object({
    name: z.string().optional(),
    displayName: z.string().optional(),
});

const IssuePayloadSchema = z.object({
    id: z.string(),
    identifier: z.string().default(''),
    title: z.string(),
    description: z.string().optional(),
    labels: z.array(LabelSchema).default([]),
    state: StateSchema.optional(),
    team: TeamSchema.optional(),
});

const CommentPayloadSchema = z.object({
    id: z.string().optional().default(''),
    body: z.string().default(''),
    user: UserSchema.optional(),
    issue: z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        state: StateSchema.optional(),
        team: TeamSchema.optional(),
        identifier: z.string().optional(),
    }).optional(),
});

export function parseIssuePayload(data: unknown): { ok: true; issue: WebhookIssue } | { ok: false; error: string } {
    const result = IssuePayloadSchema.safeParse(data);
    if (!result.success) return { ok: false, error: result.error.message };
    const d = result.data;
    return {
        ok: true,
        issue: {
            id: d.id,
            identifier: d.identifier,
            title: d.title,
            description: d.description,
            labels: d.labels,
            state: d.state ? { name: d.state.name ?? d.state.label ?? '' } : undefined,
            team: d.team?.key ? { key: d.team.key } : undefined,
        },
    };
}

export function parseCommentPayload(data: unknown): { ok: true; comment: WebhookComment } | { ok: false; error: string } {
    const result = CommentPayloadSchema.safeParse(data);
    if (!result.success) return { ok: false, error: result.error.message };
    const d = result.data;
    return {
        ok: true,
        comment: {
            id: d.id,
            body: d.body,
            author: { name: d.user?.name, displayName: d.user?.displayName },
            issue: d.issue ? {
                id: d.issue.id,
                title: d.issue.title,
                description: d.issue.description,
                state: d.issue.state ? { name: d.issue.state.name ?? d.issue.state.label ?? '' } : undefined,
                team: d.issue.team?.key ? { key: d.issue.team.key } : undefined,
                identifier: d.issue.identifier,
            } : undefined,
        },
    };
}
