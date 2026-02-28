import { mock, jest, describe, it, expect, beforeEach } from 'bun:test';
import IORedis from 'ioredis';
import { storePlan, getPlan, deletePlan, StoredPlan } from '../src/infra/plan-store';

mock.module('ioredis', () => ({
    default: mock().mockImplementation(() => ({}))
}));

describe('Plan Store', () => {
    let mockRedis: IORedis;

    beforeEach(() => {
        mockRedis = new IORedis() as IORedis;
        jest.clearAllMocks();
    });

    describe('storePlan', () => {
        it('should store a plan with TTL', async () => {
            const taskId = 'test-task-123';
            const plan: StoredPlan = {
                taskId,
                plan: 'Test plan content',
                taskContext: {
                    ticketId: taskId,
                    title: 'Test Task',
                    description: 'Test description',
                    repoUrl: 'https://github.com/test/repo',
                    branchName: 'ralph/feat-TEST-123'
                },
                feedbackHistory: [],
                createdAt: new Date(),
                status: 'pending-review'
            };

            (mockRedis as any).set = jest.fn().mockResolvedValue('OK');

            await storePlan(mockRedis, taskId, plan);

            expect((mockRedis as any).set).toHaveBeenCalledWith(
                'ralph:plan:test-task-123',
                JSON.stringify(plan),
                'EX',
                604800 // 7 days in seconds
            );
        });
    });

    describe('getPlan', () => {
        it('should retrieve a stored plan', async () => {
            const taskId = 'test-task-123';
            const storedPlan: StoredPlan = {
                taskId,
                plan: 'Test plan content',
                taskContext: {
                    ticketId: taskId,
                    title: 'Test Task',
                    description: 'Test description',
                    repoUrl: 'https://github.com/test/repo',
                    branchName: 'ralph/feat-TEST-123'
                },
                feedbackHistory: [],
                createdAt: new Date(),
                status: 'pending-review'
            };

            (mockRedis as any).get = jest.fn().mockResolvedValue(JSON.stringify(storedPlan));

            const result = await getPlan(mockRedis, taskId);

            expect((mockRedis as any).get).toHaveBeenCalledWith('ralph:plan:test-task-123');
            expect(result).toMatchObject({
                taskId,
                plan: 'Test plan content',
                status: 'pending-review'
            });
            expect(result?.createdAt).toBeInstanceOf(Date);
        });

        it('should return null for non-existent plan', async () => {
            (mockRedis as any).get = jest.fn().mockResolvedValue(null);

            const result = await getPlan(mockRedis, 'nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('deletePlan', () => {
        it('should delete a plan', async () => {
            (mockRedis as any).del = jest.fn().mockResolvedValue(1);

            await deletePlan(mockRedis, 'test-task-123');

            expect((mockRedis as any).del).toHaveBeenCalledWith('ralph:plan:test-task-123');
        });
    });
});
