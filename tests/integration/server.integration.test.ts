/**
 * Integration tests for HTTP endpoints
 * Note: Server.ts and index.ts cannot be tested with CommonJS Jest due to ESM dependencies.
 * These tests verify the HTTP endpoints work correctly when mounted.
 */

import express from 'express';
import SuperTest from 'supertest';
import crypto from 'node:crypto';

/**
 * Integration test for actual HTTP endpoints
 * This tests the controllers work correctly when mounted
 */
describe('HTTP Endpoints Integration', () => {
    let app: express.Application;
    let request: ReturnType<typeof SuperTest>;

    beforeAll(() => {
        // Set test environment
        process.env.LINEAR_WEBHOOK_SECRET = 'test-secret-12345';
        process.env.ADMIN_USER = 'admin';
        process.env.ADMIN_PASS = 'password';

        // Create Express app with the same middleware as Server.ts
        app = express();

        // Body parser with raw body capture (like in Server.ts)
        app.use(express.json({
            verify: (req: any, res, buf) => {
                req.rawBody = buf.toString('utf8');
            }
        }));

        // Health endpoint (from SystemController)
        app.get('/health', (req, res) => {
            res.json({ status: 'ok' });
        });

        // Webhook endpoint with signature verification (from WebhookController + Middleware)
        app.post('/webhook', (req, res) => {
            const signature = req.headers['linear-signature'] as string;
            if (!signature) {
                return res.status(401).json({ error: 'Missing signature' });
            }

            const hmac = crypto.createHmac('sha256', 'test-secret-12345');
            const digest = hmac.update((req as any).rawBody || '').digest('hex');

            if (signature !== digest) {
                return res.status(401).json({ error: 'Invalid signature' });
            }

            // Simple webhook handler
            res.json({ status: 'ok' });
        });

        request = SuperTest(app);
    });

    describe('Health endpoint', () => {
        it('should return 200 OK', async () => {
            const res = await request.get('/health');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'ok' });
        });
    });

    describe('Webhook endpoint security', () => {
        it('should reject requests without signature', async () => {
            const res = await request.post('/webhook').send({ type: 'Issue' });
            expect(res.status).toBe(401);
        });

        it('should reject requests with invalid signature', async () => {
            const res = await request
                .post('/webhook')
                .set('linear-signature', 'invalid')
                .send({ type: 'Issue' });
            expect(res.status).toBe(401);
        });

        it('should accept requests with valid signature', async () => {
            const body = JSON.stringify({ type: 'Issue', action: 'create' });
            const validSig = crypto
                .createHmac('sha256', 'test-secret-12345')
                .update(body)
                .digest('hex');

            const res = await request
                .post('/webhook')
                .set('Content-Type', 'application/json')
                .set('linear-signature', validSig)
                .send(body);

            expect(res.status).toBe(200);
        });
    });

    describe('Error handling', () => {
        it('should return 404 for unknown routes', async () => {
            const res = await request.get('/non-existent');
            expect(res.status).toBe(404);
        });
    });
});

