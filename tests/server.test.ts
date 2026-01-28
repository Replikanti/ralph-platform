import request from 'supertest';
import { app } from '../src/server';
import crypto from 'node:crypto';

const TEST_SECRET = crypto.randomBytes(32).toString('hex');
process.env.LINEAR_WEBHOOK_SECRET = TEST_SECRET;

// Mock BullMQ and IORedis
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
    })),
}));

jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        get: jest.fn().mockResolvedValue(null), // Default to null (not found in Redis)
    }));
});

function getSignature(body: any) {
    return crypto.createHmac('sha256', TEST_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');
}

describe('POST /webhook', () => {
    it('should reject requests with missing signature', async () => {
        const res = await request(app)
            .post('/webhook')
            .send({ type: 'Issue' });
        
        expect(res.status).toBe(401);
    });

    it('should reject requests with invalid signature', async () => {
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', 'wrong')
            .send({ type: 'Issue' });
        
        expect(res.status).toBe(401);
    });

    it('should ignore non-issue events with valid signature', async () => {
        const body = { type: 'PullRequest', action: 'create', data: {} };
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', getSignature(body))
            .send(body);
        
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored' });
    });

    it('should ignore issues without "Ralph" label', async () => {
        const body = { 
            type: 'Issue', 
            action: 'create', 
            data: { labels: [{ name: 'bug' }] } 
        };
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', getSignature(body))
            .send(body);
        
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored' });
    });

    it('should queue task for valid Ralph issue with DEFAULT_REPO_URL', async () => {
        process.env.DEFAULT_REPO_URL = 'https://github.com/test/repo';
        const body = {
            type: 'Issue',
            action: 'create',
            data: {
                id: '123',
                title: 'Fix bug',
                description: 'Fix it now',
                identifier: '1',
                labels: [{ name: 'Ralph' }]
            }
        };
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', getSignature(body))
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'queued' });
    });

    it('should use team-specific repo from LINEAR_TEAM_REPOS', async () => {
        process.env.LINEAR_TEAM_REPOS = JSON.stringify({
            'FRONT': 'https://github.com/org/frontend',
            'BACK': 'https://github.com/org/backend'
        });
        const body = {
            type: 'Issue',
            action: 'create',
            data: {
                id: '456',
                title: 'Add feature',
                description: 'New feature',
                identifier: 'FRONT-123',
                team: { key: 'FRONT' },
                labels: [{ name: 'Ralph' }]
            }
        };
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', getSignature(body))
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'queued' });
    });

    it('should ignore issue when no repo configured for team', async () => {
        delete process.env.DEFAULT_REPO_URL;
        process.env.LINEAR_TEAM_REPOS = JSON.stringify({ 'OTHER': 'https://github.com/org/other' });
        const body = {
            type: 'Issue',
            action: 'create',
            data: {
                id: '789',
                title: 'Unknown team issue',
                identifier: 'UNK-1',
                team: { key: 'UNKNOWN' },
                labels: [{ name: 'Ralph' }]
            }
        };
        const res = await request(app)
            .post('/webhook')
            .set('linear-signature', getSignature(body))
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored', reason: 'no_repo_configured' });
    });

    it('should return 200 OK for /health', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });
});
