import { mock, jest, describe, it, expect, beforeEach, afterAll } from 'bun:test';

const mockCreateComment = mock().mockResolvedValue({});
const mockIssue = mock();
const mockUpdateIssue = mock().mockResolvedValue({});
const mockStates = mock().mockResolvedValue({
    nodes: [
        { name: 'In Progress', id: 's1' },
        { name: 'plan-review', id: 's2' }
    ]
});

mock.module('../src/infra/logger', () => ({
    logger: { warn: mock(), info: mock(), error: mock() }
}));
mock.module('@linear/sdk', () => ({
    LinearClient: mock().mockImplementation(() => ({
        createComment: mockCreateComment,
        issue: mockIssue.mockResolvedValue({
            team: Promise.resolve({ states: mockStates }),
            state: Promise.resolve({ id: 's1', name: 'In Progress' })
        }),
        updateIssue: mockUpdateIssue
    }))
}));

import { LinearClient } from '../src/infra/linear-client';
import { logger } from '../src/infra/logger';

describe('LinearClient', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        mockIssue.mockResolvedValue({
            team: Promise.resolve({ states: mockStates }),
            state: Promise.resolve({ id: 's1', name: 'In Progress' })
        });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('isEnabled', () => {
        it('should return true when LINEAR_API_KEY is set', () => {
            process.env.LINEAR_API_KEY = 'test-key';
            const client = new LinearClient();
            expect(client.isEnabled()).toBe(true);
        });

        it('should return false when LINEAR_API_KEY is not set', () => {
            delete process.env.LINEAR_API_KEY;
            const client = new LinearClient();
            expect(client.isEnabled()).toBe(false);
        });
    });

    describe('postComment', () => {
        it('should post comment when enabled', async () => {
            process.env.LINEAR_API_KEY = 'test-key';
            const client = new LinearClient();
            await client.postComment('issue-123', 'Test comment');
        });

        it('should warn when not enabled', async () => {
            delete process.env.LINEAR_API_KEY;
            const client = new LinearClient();
            await client.postComment('issue-123', 'Test comment');
            expect(logger.warn as any).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY not set'));
        });
    });

    describe('updateIssueState', () => {
        it('should update state when enabled', async () => {
            process.env.LINEAR_API_KEY = 'test-key';
            const client = new LinearClient();
            await client.updateIssueState('issue-123', 'In Progress');
        });

        it('should warn when not enabled', async () => {
            delete process.env.LINEAR_API_KEY;
            const client = new LinearClient();
            await client.updateIssueState('issue-123', 'In Progress');
            expect(logger.warn as any).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY not set'));
        });
    });

    describe('getIssueState', () => {
        it('should return null when not enabled', async () => {
            delete process.env.LINEAR_API_KEY;
            const client = new LinearClient();
            const result = await client.getIssueState('issue-123');
            expect(result).toBeNull();
            expect(logger.warn as any).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY not set'));
        });
    });
});
