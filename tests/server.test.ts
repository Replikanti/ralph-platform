import request from 'supertest';
import crypto from 'node:crypto';

// Setup environment BEFORE importing server
const TEST_SECRET = crypto.randomBytes(32).toString('hex');
process.env.LINEAR_WEBHOOK_SECRET = TEST_SECRET;
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'password';

import { app } from '../src/server';
import { getPlan } from '../src/plan-store';
import {
    createIssueWebhook,
    createCommentWebhook,
    getSignature,
    sendWebhook,
    createMockStoredPlan
} from './fixtures';

// Mock fs
jest.mock('node:fs/promises', () => ({
    stat: jest.fn().mockResolvedValue({ mtimeMs: 1000 }),
    readFile: jest.fn().mockResolvedValue('{}')
}));

// Mock BullMQ and IORedis
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
    })),
}));

// Mock Bull Board
jest.mock('@bull-board/api', () => ({
    createBullBoard: jest.fn(),
}));
jest.mock('@bull-board/api/bullMQAdapter', () => ({
    BullMQAdapter: jest.fn(),
}));
jest.mock('@bull-board/express', () => ({
    ExpressAdapter: jest.fn().mockImplementation(() => ({
        setBasePath: jest.fn(),
        getRouter: jest.fn().mockReturnValue((req: any, res: any, next: any) => next()),
    })),
}));

jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        get: jest.fn().mockResolvedValue(null), // Default to null (not found in Redis)
        set: jest.fn().mockResolvedValue('OK'),
    }));
});

// Mock plan-store
jest.mock('../src/plan-store', () => ({
    getPlan: jest.fn(),
    storePlan: jest.fn(),
    updatePlanStatus: jest.fn(),
    appendFeedback: jest.fn(),
    deletePlan: jest.fn()
}));

// Helper wrapper that uses the TEST_SECRET
async function sendWebhookWithTestSecret(body: any, options: { withSignature?: boolean; signature?: string } = {}) {
    return sendWebhook(app, body, TEST_SECRET, options);
}

function getSignatureWithTestSecret(body: any) {
    return getSignature(body, TEST_SECRET);
}

describe('POST /webhook', () => {
    it('should reject requests with missing signature', async () => {
        const res = await sendWebhookWithTestSecret({ type: 'Issue' }, { withSignature: false });
        expect(res.status).toBe(401);
    });

    it('should reject requests with invalid signature', async () => {
        const res = await sendWebhookWithTestSecret({ type: 'Issue' }, { signature: 'wrong' });
        expect(res.status).toBe(401);
    });

    it('should ignore non-issue events with valid signature', async () => {
        const body = { type: 'PullRequest', action: 'create', data: {} };
        const res = await sendWebhookWithTestSecret(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored' });
    });

    it('should ignore issues without "Ralph" label', async () => {
        const body = createIssueWebhook({
            identifier: 'TEST-1',
            labels: [{ name: 'bug' }]
        });
        const res = await sendWebhookWithTestSecret(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored', reason: 'no_ralph_label' });
    });

    it('should queue task for valid Ralph issue with DEFAULT_REPO_URL', async () => {
        process.env.DEFAULT_REPO_URL = 'https://github.com/test/repo';
        const body = createIssueWebhook({
            id: '123',
            title: 'Fix bug',
            description: 'Fix it now',
            identifier: '1',
            labels: [{ name: 'Ralph' }]
        });
        const res = await sendWebhookWithTestSecret(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'queued' });
    });

    it('should use team-specific repo from LINEAR_TEAM_REPOS', async () => {
        process.env.LINEAR_TEAM_REPOS = JSON.stringify({
            'FRONT': 'https://github.com/org/frontend',
            'BACK': 'https://github.com/org/backend'
        });
        const body = createIssueWebhook({
            id: '456',
            title: 'Add feature',
            description: 'New feature',
            identifier: 'FRONT-123',
            team: { key: 'FRONT' },
            labels: [{ name: 'Ralph' }]
        });
        const res = await sendWebhookWithTestSecret(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'queued' });
    });

    it('should ignore issue when no repo configured for team', async () => {
        delete process.env.DEFAULT_REPO_URL;
        process.env.LINEAR_TEAM_REPOS = JSON.stringify({ 'OTHER': 'https://github.com/org/other' });
        const body = createIssueWebhook({
            id: '789',
            title: 'Unknown team issue',
            identifier: 'UNK-1',
            team: { key: 'UNKNOWN' },
            labels: [{ name: 'Ralph' }]
        });
        const res = await sendWebhookWithTestSecret(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored', reason: 'no_repo_configured' });
    });

    it('should return 200 OK for /health', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });

    it('should protect /admin/queues with Basic Auth', async () => {
        const res = await request(app).get('/admin/queues');
        expect(res.status).toBe(401);
    });

    describe('Comment webhooks (plan review)', () => {
        const mockStoredPlan = createMockStoredPlan();

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should ignore comments when no stored plan exists', async () => {
            (getPlan as jest.Mock).mockResolvedValue(null);

            const body = createCommentWebhook({
                body: 'LGTM',
                issue: {
                    id: 'issue-123',
                    state: { name: 'In Progress' }
                }
            });

            const res = await request(app)
                .post('/webhook')
                .set('linear-signature', getSignatureWithTestSecret(body))
                .send(body);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ignored', reason: 'no_stored_plan' });
        });

        it('should handle approval comment and queue execution job', async () => {
            (getPlan as jest.Mock).mockResolvedValue(mockStoredPlan);

            const body = createCommentWebhook({
                body: 'LGTM, let\'s proceed!',
                issue: {
                    id: 'issue-123',
                    state: { name: 'plan-review' }
                }
            });

            const res = await request(app)
                .post('/webhook')
                .set('linear-signature', getSignatureWithTestSecret(body))
                .send(body);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('execution_queued');
            expect(res.body.jobId).toMatch(/^issue-123-exec-\d+$/);
            expect(getPlan).toHaveBeenCalledWith(expect.anything(), 'issue-123');
        });

        it('should handle feedback comment and queue re-planning job', async () => {
            (getPlan as jest.Mock).mockResolvedValue(mockStoredPlan);

            const body = createCommentWebhook({
                body: 'Please add more error handling',
                issue: {
                    id: 'issue-123',
                    state: { name: 'plan-review' }
                }
            });

            const res = await request(app)
                .post('/webhook')
                .set('linear-signature', getSignatureWithTestSecret(body))
                .send(body);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('replanning_queued');
            expect(res.body.jobId).toMatch(/^issue-123-replan-\d+$/);
            expect(getPlan).toHaveBeenCalledWith(expect.anything(), 'issue-123');
        });

        it('should process comments with stored plan even if state is not plan-review', async () => {
            (getPlan as jest.Mock).mockResolvedValue(mockStoredPlan);

            const body = createCommentWebhook({
                body: 'LGTM',
                issue: {
                    id: 'issue-123',
                    state: { name: 'In Review' } // Wrong state, but has stored plan
                }
            });

            const res = await request(app)
                .post('/webhook')
                .set('linear-signature', getSignatureWithTestSecret(body))
                .send(body);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('execution_queued');
            expect(res.body.jobId).toMatch(/^issue-123-exec-\d+$/);
        });

        it('should recognize various approval phrases', async () => {
            (getPlan as jest.Mock).mockResolvedValue(mockStoredPlan);

            const approvalPhrases = ['lgtm', 'LGTM', 'approved', 'Proceed', 'ship it', 'Ship It!'];

            for (const phrase of approvalPhrases) {
                const body = createCommentWebhook({
                    body: phrase,
                    issue: {
                        id: 'issue-123',
                        state: { name: 'plan-review' }
                    }
                });

                const res = await request(app)
                    .post('/webhook')
                    .set('linear-signature', getSignatureWithTestSecret(body))
                    .send(body);

                expect(res.status).toBe(200);
                expect(res.body.status).toBe('execution_queued');
                expect(res.body.jobId).toMatch(/^issue-123-exec-\d+$/);
            }
        });
    });
});
