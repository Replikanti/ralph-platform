import { mock, jest, describe, it, expect, beforeEach } from 'bun:test';

// ── Top-level mock instances (MUST be outside factories so tests share them) ──

// ioredis
const mockIoRedisGet = mock().mockResolvedValue(null);
const mockIoRedisSet = mock().mockResolvedValue('OK');
const mockIoRedisOn = mock();
const mockIoRedisConstructor = mock().mockImplementation(() => ({
    on: mockIoRedisOn,
    get: mockIoRedisGet,
    set: mockIoRedisSet,
}));

// @bull-board
const mockGetRouter = mock().mockReturnValue((_req: any, _res: any, next: any) => next());
const mockSetBasePath = mock();
const mockExpressAdapterConstructor = mock().mockImplementation(() => ({
    setBasePath: mockSetBasePath,
    getRouter: mockGetRouter,
}));
const mockCreateBullBoard = mock();
const mockBullMQAdapter = mock();

// fs/promises
const mockFsStat = mock().mockResolvedValue({ mtimeMs: 1000 });
const mockFsReadFile = mock().mockResolvedValue('{}');

// plan-store
const mockGetPlan = mock();
const mockStorePlan = mock();
const mockUpdatePlanStatus = mock();
const mockAppendFeedback = mock();
const mockDeletePlan = mock();

// linear-client
const mockUpdateIssueState = mock().mockResolvedValue(undefined);
const mockLinearClientConstructor = mock().mockImplementation(() => ({
    updateIssueState: mockUpdateIssueState,
    postComment: mock().mockResolvedValue(undefined),
}));

// ── Module mocks (hoisted before static imports by bun) ──

mock.module('ioredis', () => ({
    default: mockIoRedisConstructor,
}));

// bullmq is mocked by the preload (setup.ts) using the same mockQueueAdd from
// fixtures/queue-mock — no separate mock.module needed here.

mock.module('@bull-board/api', () => ({
    createBullBoard: mockCreateBullBoard,
}));

mock.module('@bull-board/api/bullMQAdapter', () => ({
    BullMQAdapter: mockBullMQAdapter,
}));

mock.module('@bull-board/express', () => ({
    ExpressAdapter: mockExpressAdapterConstructor,
}));

mock.module('node:fs/promises', () => ({
    default: { stat: mockFsStat, readFile: mockFsReadFile },
    stat: mockFsStat,
    readFile: mockFsReadFile,
}));

mock.module('../src/infra/plan-store', () => ({
    getPlan: mockGetPlan,
    storePlan: mockStorePlan,
    updatePlanStatus: mockUpdatePlanStatus,
    appendFeedback: mockAppendFeedback,
    deletePlan: mockDeletePlan,
}));

mock.module('../src/infra/linear-client', () => ({
    LinearClient: mockLinearClientConstructor,
}));

// ── Static imports (run after hoisted mocks) ──

import request from 'supertest';
import { app } from '../src/platform/server';
import {
    createIssueWebhook,
    createCommentWebhook,
    getSignature,
    sendWebhook,
    createMockStoredPlan
} from './fixtures';
// bullmq Queue — shared with the preload (setup.ts) so this file and the
// preload's mock.module factory reference the *same* mockQueueAdd function.
import { mockQueueAdd } from './fixtures/queue-mock';

// Fixed secret — matches what tests/setup.ts sets in process.env
const TEST_SECRET = 'test-linear-webhook-secret-12345678';

// ── Helpers ──

async function sendWebhookWithTestSecret(body: any, options: { withSignature?: boolean; signature?: string } = {}) {
    return sendWebhook(app, body, TEST_SECRET, options);
}

function getSignatureWithTestSecret(body: any) {
    return getSignature(body, TEST_SECRET);
}

async function sendCommentWebhookWithPlan(options: {
    commentBody: string;
    issueId?: string;
    stateName?: string;
    storedPlan?: any;
}) {
    const { commentBody, issueId = 'issue-123', stateName = 'plan-review' } = options;
    const planValue = 'storedPlan' in options ? options.storedPlan : createMockStoredPlan();
    mockGetPlan.mockResolvedValue(planValue);

    const body = createCommentWebhook({
        body: commentBody,
        issue: {
            id: issueId,
            state: { name: stateName }
        }
    });

    return request(app)
        .post('/webhook')
        .set('linear-signature', getSignatureWithTestSecret(body))
        .send(body);
}

function expectJobQueued(res: any, type: 'execution' | 'replanning') {
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(`${type}_queued`);
    expect(res.body.jobId).toBe(type === 'execution' ? 'issue-123-exec' : 'issue-123-replan');
}

// ── Tests ──

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

    it.each([
        ['DEFAULT_REPO_URL', () => { process.env.DEFAULT_REPO_URL = 'https://github.com/test/repo'; return {}; }],
        ['LINEAR_TEAM_REPOS', () => {
            process.env.LINEAR_TEAM_REPOS = JSON.stringify({ 'FRONT': 'https://github.com/org/frontend' });
            return { team: { key: 'FRONT' }, identifier: 'FRONT-123' };
        }]
    ])('should queue task for valid Ralph issue via %s', async (_, setup) => {
        const overrides = setup();
        const body = createIssueWebhook({
            id: '123',
            title: 'Fix bug',
            labels: [{ name: 'Ralph' }],
            ...overrides
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
        beforeEach(() => {
            jest.clearAllMocks();
            mockGetPlan.mockResolvedValue(null);
            mockQueueAdd.mockResolvedValue({ id: 'job-mock' });
            mockUpdateIssueState.mockResolvedValue(undefined);
        });

        it('should ignore comments when no stored plan exists', async () => {
            const res = await sendCommentWebhookWithPlan({
                commentBody: 'LGTM',
                stateName: 'In Progress',
                storedPlan: null
            });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ignored', reason: 'no_stored_plan' });
        });

        it('should handle approval comment and queue execution job', async () => {
            const res = await sendCommentWebhookWithPlan({
                commentBody: 'LGTM, let\'s proceed!'
            });

            expectJobQueued(res, 'execution');
            expect(mockGetPlan).toHaveBeenCalledWith(expect.anything(), 'issue-123');
        });

        it('should handle feedback comment and queue re-planning job', async () => {
            const res = await sendCommentWebhookWithPlan({
                commentBody: 'Please add more error handling'
            });

            expectJobQueued(res, 'replanning');
            expect(mockGetPlan).toHaveBeenCalledWith(expect.anything(), 'issue-123');
        });

        it.each([
            ['LGTM', 'plan-review'],
            ['approved', 'plan-review'],
            ['ship it', 'plan-review'],
            ['LGTM', 'In Review']
        ])('should handle approval comment "%s" in state "%s"', async (comment, state) => {
            const res = await sendCommentWebhookWithPlan({
                commentBody: comment,
                stateName: state
            });

            if (state === 'In Review') {
                expect(res.status).toBe(200);
                expect(res.body).toEqual({ status: 'ignored', reason: 'already_processed' });
            } else {
                expectJobQueued(res, 'execution');
            }
        });

        it('should ignore approval comment if issue is already In Progress', async () => {
            const res = await sendCommentWebhookWithPlan({
                commentBody: 'LGTM',
                stateName: 'In Progress'
            });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ignored', reason: 'already_processed' });
        });

        it('should ignore Ralph\'s own comments to prevent auto-execution', async () => {
            mockGetPlan.mockResolvedValue(createMockStoredPlan());

            const ralphPlanComment = createCommentWebhook({
                body: '# 🤖 Ralph\'s Implementation Plan\n\n**To proceed:** Reply with LGTM, approved, proceed, or ship it',
                issue: {
                    id: 'issue-123',
                    state: { name: 'In Progress' }
                }
            });

            ralphPlanComment.data.user = { name: 'Ralph Bot', displayName: 'Ralph' };

            const res = await request(app)
                .post('/webhook')
                .set('linear-signature', getSignatureWithTestSecret(ralphPlanComment))
                .send(ralphPlanComment);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ignored', reason: 'ralph_comment' });
        });
    });
});

// ── Security: PII/secret redaction at the queue boundary ─────────────────────
//
// These tests send webhook payloads that contain real secret patterns and assert
// that the data reaching the BullMQ queue is already redacted.  The real
// redactText() pipeline runs here (security/redactor is NOT mocked in this file).
//
// We capture the call count before each test and read the NEXT call after it,
// avoiding jest.clearAllMocks() which breaks mock call recording in Bun.

describe('Security: PII and secrets are redacted before entering the queue', () => {
    // A syntactically valid AWS access key matching the redactor pattern.
    const AWS_KEY    = 'AKIAIOSFODNN7EXAMPLE';
    const AWS_REDACT = '<AWS_ACCESS_KEY_REDACTED>';

    // A syntactically valid GitHub PAT matching the redactor pattern.
    const GH_TOKEN  = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const GH_REDACT = '<GITHUB_TOKEN_REDACTED>';

    // We capture the job data via a custom implementation rather than relying on
    // mock.calls — jest.clearAllMocks() in the comment-webhook beforeEach breaks
    // Bun's call-recording for all subsequent tests.
    let capturedJobData: any;

    beforeEach(() => {
        capturedJobData = undefined;
        mockQueueAdd.mockImplementation(async (_name: string, data: any) => {
            capturedJobData = data;
            return { id: 'job-mock' };
        });
        process.env.DEFAULT_REPO_URL = 'https://github.com/test/repo';
    });

    it('redacts a secret in issue title before enqueueing', async () => {
        const body = createIssueWebhook({
            id: 'sec-1',
            title: `Deploy app with key ${AWS_KEY} configured`,
            labels: [{ name: 'Ralph' }],
        });
        const res = await sendWebhookWithTestSecret(body);
        expect(res.status).toBe(200);

        expect(capturedJobData).toBeDefined();
        expect(capturedJobData.title).not.toContain(AWS_KEY);
        expect(capturedJobData.title).toContain(AWS_REDACT);
    });

    it('redacts a secret in issue description before enqueueing', async () => {
        const body = createIssueWebhook({
            id: 'sec-2',
            title: 'Routine task',
            description: `Use token ${GH_TOKEN} to push`,
            labels: [{ name: 'Ralph' }],
        });
        const res = await sendWebhookWithTestSecret(body);
        expect(res.status).toBe(200);

        expect(capturedJobData).toBeDefined();
        expect(capturedJobData.description).not.toContain(GH_TOKEN);
        expect(capturedJobData.description).toContain(GH_REDACT);
    });

    it('redacts a secret in revision feedback before enqueueing', async () => {
        const storedPlan = createMockStoredPlan();
        mockGetPlan.mockResolvedValue(storedPlan);

        const body = createCommentWebhook({
            body: `Please use ${AWS_KEY} when configuring the deploy`,
            issue: { id: 'sec-3', state: { name: 'plan-review' } },
        });
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', getSignatureWithTestSecret(body))
            .send(body);
        expect(res.status).toBe(200);

        expect(capturedJobData).toBeDefined();
        expect(capturedJobData.additionalFeedback).not.toContain(AWS_KEY);
        expect(capturedJobData.additionalFeedback).toContain(AWS_REDACT);
    });
});
