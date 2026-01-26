import request from 'supertest';
import { app } from '../src/server';

// Mock BullMQ and IORedis
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
    })),
}));

jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
    }));
});

describe('POST /webhook', () => {
    it('should ignore non-issue events', async () => {
        const res = await request(app)
            .post('/webhook')
            .send({ type: 'PullRequest', action: 'create', data: {} });
        
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored' });
    });

    it('should ignore issues without "Ralph" label', async () => {
        const res = await request(app)
            .post('/webhook')
            .send({ 
                type: 'Issue', 
                action: 'create', 
                data: { labels: [{ name: 'bug' }] } 
            });
        
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ignored' });
    });

    it('should queue task for valid Ralph issue', async () => {
        const res = await request(app)
            .post('/webhook')
            .send({ 
                type: 'Issue', 
                action: 'create', 
                data: { 
                    id: '123',
                    title: 'Fix bug',
                    description: 'Fix it now',
                    identifier: '1',
                    labels: [{ name: 'Ralph' }] 
                } 
            });
        
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'queued' });
    });
});
