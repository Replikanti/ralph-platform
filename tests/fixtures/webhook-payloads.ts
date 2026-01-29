import crypto from 'node:crypto';
import request from 'supertest';

export interface IssueWebhookOptions {
    id?: string;
    title?: string;
    description?: string;
    identifier?: string;
    labels?: { name: string }[];
    team?: { key: string };
}

export interface CommentWebhookOptions {
    body: string;
    issue: {
        id: string;
        state: { name: string };
    };
}

/**
 * Creates an issue webhook payload with optional overrides
 */
export function createIssueWebhook(data: IssueWebhookOptions = {}): any {
    return {
        type: 'Issue',
        action: 'create',
        data: {
            id: data.id || '123',
            title: data.title || 'Default title',
            description: data.description,
            identifier: data.identifier || 'TEST-1',
            labels: data.labels || [],
            team: data.team,
        }
    };
}

/**
 * Creates a comment webhook payload
 */
export function createCommentWebhook(data: CommentWebhookOptions): any {
    return {
        type: 'Comment',
        action: 'create',
        data
    };
}

/**
 * Generates HMAC signature for webhook payload
 */
export function getSignature(body: any, secret: string): string {
    return crypto.createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
}

/**
 * Helper to send webhook requests with proper signature
 */
export async function sendWebhook(
    app: any,
    body: any,
    secret: string,
    options: { withSignature?: boolean; signature?: string } = {}
) {
    const req = request(app).post('/webhook');

    if (options.signature) {
        req.set('linear-signature', options.signature);
    } else if (options.withSignature !== false) {
        req.set('linear-signature', getSignature(body, secret));
    }

    return req.send(body);
}
