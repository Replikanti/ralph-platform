// Mock Ts.ED decorators before imports
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
    Inject: () => (target: any, propertyKey: string) => {},
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    })),
}));

import { PlanStoreService, StoredPlan } from '../../src/services/PlanStoreService';
import { RedisProvider } from '../../src/services/RedisProvider';

describe('PlanStoreService', () => {
    let service: PlanStoreService;
    let mockRedis: any;

    beforeEach(() => {
        // Mock RedisProvider with connection object
        mockRedis = {
            connection: {
                get: jest.fn(),
                set: jest.fn(),
                del: jest.fn(),
            },
        };

        service = new PlanStoreService();
        // Manually inject the mock RedisProvider
        (service as any).redis = mockRedis;
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

            mockRedis.connection.set.mockResolvedValue('OK');

            await service.storePlan(taskId, plan);

            expect(mockRedis.connection.set).toHaveBeenCalledWith(
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

            mockRedis.connection.get.mockResolvedValue(JSON.stringify(storedPlan));

            const result = await service.getPlan(taskId);

            expect(mockRedis.connection.get).toHaveBeenCalledWith('ralph:plan:test-task-123');
            expect(result).toMatchObject({
                taskId,
                plan: 'Test plan content',
                status: 'pending-review'
            });
            expect(result?.createdAt).toBeInstanceOf(Date);
        });

        it('should return null for non-existent plan', async () => {
            mockRedis.connection.get.mockResolvedValue(null);

            const result = await service.getPlan('nonexistent');

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

            mockRedis.connection.get.mockResolvedValue(JSON.stringify(existingPlan));
            mockRedis.connection.set.mockResolvedValue('OK');

            await service.updatePlanStatus(taskId, 'approved');

            expect(mockRedis.connection.set).toHaveBeenCalled();
            const setCall = mockRedis.connection.set.mock.calls[0];
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

            mockRedis.connection.get.mockResolvedValue(JSON.stringify(existingPlan));
            mockRedis.connection.set.mockResolvedValue('OK');

            await service.appendFeedback(taskId, 'Second feedback');

            expect(mockRedis.connection.set).toHaveBeenCalled();
            const setCall = mockRedis.connection.set.mock.calls[0];
            const savedPlan = JSON.parse(setCall[1]);
            expect(savedPlan.feedbackHistory).toEqual(['First feedback', 'Second feedback']);
            expect(savedPlan.status).toBe('needs-revision');
        });
    });

    describe('deletePlan', () => {
        it('should delete a plan', async () => {
            mockRedis.connection.del.mockResolvedValue(1);

            await service.deletePlan('test-task-123');

            expect(mockRedis.connection.del).toHaveBeenCalledWith('ralph:plan:test-task-123');
        });
    });
});
