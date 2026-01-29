import IORedis from 'ioredis';
import { storePlan, getPlan, updatePlanStatus, appendFeedback, deletePlan } from '../src/plan-store';
import { StoredPlan } from '../src/agent';

jest.mock('ioredis');

describe('Plan Store', () => {
    let mockRedis: jest.Mocked<IORedis>;

    beforeEach(() => {
        mockRedis = new IORedis() as jest.Mocked<IORedis>;
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

            mockRedis.set = jest.fn().mockResolvedValue('OK');

            await storePlan(mockRedis, taskId, plan);

            expect(mockRedis.set).toHaveBeenCalledWith(
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

            mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(storedPlan));

            const result = await getPlan(mockRedis, taskId);

            expect(mockRedis.get).toHaveBeenCalledWith('ralph:plan:test-task-123');
            expect(result).toMatchObject({
                taskId,
                plan: 'Test plan content',
                status: 'pending-review'
            });
            expect(result?.createdAt).toBeInstanceOf(Date);
        });

        it('should return null for non-existent plan', async () => {
            mockRedis.get = jest.fn().mockResolvedValue(null);

            const result = await getPlan(mockRedis, 'nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('updatePlanStatus', () => {
        it('should update plan status', async () => {
            const taskId = 'test-task-123';
            const existingPlan: StoredPlan = {
                taskId,
                plan: 'Test plan content',
                taskContext: {
                    ticketId: taskId,
                    title: 'Test Task',
                    repoUrl: 'https://github.com/test/repo',
                    branchName: 'ralph/feat-TEST-123'
                },
                feedbackHistory: [],
                createdAt: new Date(),
                status: 'pending-review'
            };

            mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(existingPlan));
            mockRedis.set = jest.fn().mockResolvedValue('OK');

            await updatePlanStatus(mockRedis, taskId, 'approved');

            expect(mockRedis.set).toHaveBeenCalled();
            const setCall = (mockRedis.set as jest.Mock).mock.calls[0];
            const savedPlan = JSON.parse(setCall[1]);
            expect(savedPlan.status).toBe('approved');
        });
    });

    describe('appendFeedback', () => {
        it('should append feedback to plan', async () => {
            const taskId = 'test-task-123';
            const existingPlan: StoredPlan = {
                taskId,
                plan: 'Test plan content',
                taskContext: {
                    ticketId: taskId,
                    title: 'Test Task',
                    repoUrl: 'https://github.com/test/repo',
                    branchName: 'ralph/feat-TEST-123'
                },
                feedbackHistory: ['First feedback'],
                createdAt: new Date(),
                status: 'pending-review'
            };

            mockRedis.get = jest.fn().mockResolvedValue(JSON.stringify(existingPlan));
            mockRedis.set = jest.fn().mockResolvedValue('OK');

            await appendFeedback(mockRedis, taskId, 'Second feedback');

            expect(mockRedis.set).toHaveBeenCalled();
            const setCall = (mockRedis.set as jest.Mock).mock.calls[0];
            const savedPlan = JSON.parse(setCall[1]);
            expect(savedPlan.feedbackHistory).toEqual(['First feedback', 'Second feedback']);
            expect(savedPlan.status).toBe('needs-revision');
        });
    });

    describe('deletePlan', () => {
        it('should delete a plan', async () => {
            mockRedis.del = jest.fn().mockResolvedValue(1);

            await deletePlan(mockRedis, 'test-task-123');

            expect(mockRedis.del).toHaveBeenCalledWith('ralph:plan:test-task-123');
        });
    });
});
