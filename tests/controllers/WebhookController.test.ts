// Mock Ts.ED decorators before imports
import { mockTsEdDecorators } from '../test-utils/common-mocks';
import { TEST_CREDENTIALS } from '../test-utils/constants';

const mocks = mockTsEdDecorators();
jest.mock('@tsed/common', () => mocks['@tsed/common']);
jest.mock('@tsed/di', () => mocks['@tsed/di']);
jest.mock('@tsed/logger', () => mocks['@tsed/logger']);
jest.mock('@tsed/exceptions', () => mocks['@tsed/exceptions']);

import express, { Express } from "express";
import SuperTest from "supertest";
import crypto from "node:crypto";
import { WebhookController } from "../../src/controllers/WebhookController";
import { createIssueWebhook, createCommentWebhook, getSignature } from "../fixtures/webhook-payloads";
import { createMockStoredPlan } from "../fixtures/mocks";

const TEST_SECRET = TEST_CREDENTIALS.WEBHOOK_SECRET;

describe("WebhookController", () => {
    let app: Express;
    let request: ReturnType<typeof SuperTest>;
    let controller: WebhookController;

    // Mock services
    const mockQueue = {
        enqueueIssue: jest.fn().mockResolvedValue({ status: "queued", jobId: "test-id" }),
        enqueueExecution: jest.fn().mockResolvedValue({ status: "execution_queued", jobId: "issue-123-exec" }),
        enqueueReplanning: jest.fn().mockResolvedValue({ status: "replanning_queued", jobId: "issue-123-replan" }),
        enqueueIteration: jest.fn().mockResolvedValue({ status: "iteration_queued", jobId: "test-iterate" }),
    };

    const mockConfig = {
        getRepoForTeam: jest.fn().mockResolvedValue("https://github.com/test/repo"),
    };

    const mockPlanStore = {
        getPlan: jest.fn().mockResolvedValue(null),
        storePlan: jest.fn(),
        deletePlan: jest.fn(),
        updatePlanStatus: jest.fn(),
        appendFeedback: jest.fn(),
    };

    const mockLinear = {
        updateIssueState: jest.fn().mockResolvedValue(true),
        postComment: jest.fn(),
        getIssueState: jest.fn(),
        isEnabled: jest.fn().mockReturnValue(true),
        updateIssueWithComment: jest.fn(),
    };

    const mockRedis = {
        connection: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
        },
    };

    beforeAll(() => {
        process.env.LINEAR_WEBHOOK_SECRET = TEST_SECRET;

        // Create Express app
        app = express();
        app.use(express.json({
            verify: (req: any, res, buf) => {
                req.rawBody = buf.toString('utf8');
            }
        }));

        // Signature verification middleware
        app.use('/webhook', (req, res, next) => {
            const signature = req.headers['linear-signature'] as string;
            if (!signature) {
                return res.status(401).send({ error: "Missing signature" });
            }

            const expectedSignature = crypto
                .createHmac('sha256', TEST_SECRET)
                .update((req as any).rawBody || JSON.stringify(req.body))
                .digest('hex');

            if (signature !== expectedSignature) {
                return res.status(401).send({ error: "Invalid signature" });
            }

            next();
        });

        // Mount controller
        controller = new WebhookController();
        (controller as any).queue = mockQueue;
        (controller as any).config = mockConfig;
        (controller as any).planStore = mockPlanStore;
        (controller as any).linear = mockLinear;
        (controller as any).redis = mockRedis;

        app.post('/webhook', (req, res) => controller.handleWebhook(req as any, res as any));

        request = SuperTest(app);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.connection.get.mockResolvedValue(null);
        mockConfig.getRepoForTeam.mockResolvedValue("https://github.com/test/repo");
        mockPlanStore.getPlan.mockResolvedValue(null);
    });

    // Helper to send webhook with signature
    async function sendWebhook(body: any, options: { withSignature?: boolean; signature?: string } = {}) {
        const { withSignature = true, signature } = options;
        const sig = signature || (withSignature ? getSignature(body, TEST_SECRET) : undefined);

        const req = request.post("/webhook").send(body);
        if (sig) {
            req.set("linear-signature", sig);
        }
        return req;
    }

    // --- Signature Verification Tests ---

    describe("Signature Verification", () => {
        it("should reject requests with missing signature", async () => {
            const res = await sendWebhook({ type: "Issue" }, { withSignature: false });
            expect(res.status).toBe(401);
        });

        it("should reject requests with invalid signature", async () => {
            const res = await sendWebhook({ type: "Issue" }, { signature: "wrong" });
            expect(res.status).toBe(401);
        });

        it("should accept requests with valid signature", async () => {
            const body = { type: "PullRequest", action: "create", data: {} };
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored" });
        });
    });

    // --- Issue Webhook Tests ---

    describe("Issue Webhooks", () => {
        it("should ignore non-issue events", async () => {
            const body = { type: "PullRequest", action: "create", data: {} };
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored" });
        });

        it("should skip issues without Ralph label", async () => {
            const body = createIssueWebhook({
                identifier: "TEST-1",
                labels: [{ name: "bug" }],
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "no_ralph_label" });
        });

        it("should enqueue issues with Ralph label", async () => {
            const body = createIssueWebhook({
                id: "123",
                title: "Fix bug",
                labels: [{ name: "Ralph" }],
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("status", "queued");
            expect(mockQueue.enqueueIssue).toHaveBeenCalled();
        });

        it("should skip issues in terminal states on update", async () => {
            const body = createIssueWebhook({
                id: "456",
                action: "update",
                state: { name: "In Progress" },
                labels: [{ name: "Ralph" }],
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "already_processed" });
        });

        it("should skip issues with tombstone", async () => {
            mockRedis.connection.get.mockResolvedValueOnce("true");
            const body = createIssueWebhook({
                id: "789",
                labels: [{ name: "Ralph" }],
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "tombstone_present" });
        });

        it("should ignore issue when no repo configured for team", async () => {
            mockConfig.getRepoForTeam.mockResolvedValueOnce(null);
            const body = createIssueWebhook({
                id: "789",
                title: "Unknown team issue",
                team: { key: "UNKNOWN" },
                labels: [{ name: "Ralph" }],
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "no_repo_configured" });
        });
    });

    // --- Comment Webhook Tests ---

    describe("Comment Webhooks", () => {
        it("should ignore Ralph's own comments", async () => {
            const body = createCommentWebhook({
                body: "# 🤖 Ralph's Implementation Plan",
                user: { name: "Ralph Bot", displayName: "Ralph" },
                issue: {
                    id: "issue-123",
                    state: { name: "plan-review" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "ralph_comment" });
        });

        it("should ignore comments when no stored plan exists", async () => {
            const body = createCommentWebhook({
                body: "LGTM",
                issue: {
                    id: "issue-123",
                    state: { name: "In Progress" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "no_stored_plan" });
        });

        it("should process approval comment on stored plan", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce(createMockStoredPlan());
            const body = createCommentWebhook({
                body: "LGTM, let's proceed!",
                issue: {
                    id: "issue-123",
                    state: { name: "plan-review" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("status", "execution_queued");
            expect(mockQueue.enqueueExecution).toHaveBeenCalled();
        });

        it("should process feedback on stored plan", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce(createMockStoredPlan());
            const body = createCommentWebhook({
                body: "Please add more error handling",
                issue: {
                    id: "issue-123",
                    state: { name: "plan-review" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("status", "replanning_queued");
            expect(mockQueue.enqueueReplanning).toHaveBeenCalled();
        });

        it("should ignore approval if issue already in progress", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce(createMockStoredPlan());
            const body = createCommentWebhook({
                body: "LGTM",
                issue: {
                    id: "issue-123",
                    state: { name: "In Progress" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "already_processed" });
        });

        it("should handle PR iteration for in-review issues", async () => {
            mockConfig.getRepoForTeam.mockResolvedValueOnce("https://github.com/test/repo");
            const body = createCommentWebhook({
                body: "Please fix the formatting",
                issue: {
                    id: "issue-456",
                    identifier: "TEST-456",
                    state: { name: "In Review" },
                    team: { key: "FRONT" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("status", "iteration_queued");
            expect(mockQueue.enqueueIteration).toHaveBeenCalled();
        });
    });

    // --- Error Path Tests ---

    describe("Error Handling", () => {
        it("should handle queue failure in handleIssue", async () => {
            mockQueue.enqueueIssue.mockRejectedValueOnce(new Error("Queue error"));
            const body = createIssueWebhook({
                labels: [{ name: "Ralph" }],
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: "queue_failed" });
        });

        it("should handle missing issueId in comment webhook", async () => {
            // Create payload with missing issue.id
            const body = {
                type: "Comment",
                action: "create",
                data: {
                    body: "Test comment",
                    user: { name: "Test User" },
                    issue: {
                        // No id field
                        state: { name: "Todo" },
                    },
                },
            };
            const res = await sendWebhook(body);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: "missing_issue_id" });
        });

        it("should handle queue failure in handlePlanApproval", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce(createMockStoredPlan());
            mockQueue.enqueueExecution.mockRejectedValueOnce(new Error("Queue error"));
            const body = createCommentWebhook({
                body: "LGTM",
                issue: {
                    id: "issue-123",
                    state: { name: "Todo" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: "queue_failed" });
        });

        it("should handle queue failure in handlePlanRevision", async () => {
            mockPlanStore.getPlan.mockResolvedValueOnce(createMockStoredPlan());
            mockQueue.enqueueReplanning.mockRejectedValueOnce(new Error("Queue error"));
            const body = createCommentWebhook({
                body: "Please change the approach",
                issue: {
                    id: "issue-123",
                    state: { name: "Todo" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: "queue_failed" });
        });

        it("should handle missing repo config in handleIterationRequest", async () => {
            mockConfig.getRepoForTeam.mockResolvedValueOnce(null); // No repo configured
            const body = createCommentWebhook({
                body: "Please fix",
                issue: {
                    id: "issue-456",
                    state: { name: "In Review" },
                    team: { key: "UNKNOWN" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ignored", reason: "no_repo_configured" });
        });

        it("should handle queue failure in handleIterationRequest", async () => {
            mockQueue.enqueueIteration.mockRejectedValueOnce(new Error("Queue error"));
            const body = createCommentWebhook({
                body: "Please fix",
                issue: {
                    id: "issue-456",
                    identifier: "TEST-456",
                    state: { name: "In Review" },
                    team: { key: "FRONT" },
                },
            });
            const res = await sendWebhook(body);
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: "queue_failed" });
        });
    });
});
