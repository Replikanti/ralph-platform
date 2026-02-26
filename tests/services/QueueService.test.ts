// Mock Ts.ED decorators
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
    Inject: () => (target: any, propertyKey: string) => {},
    OnInit: jest.fn(),
    OnDestroy: jest.fn(),
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock BullMQ
const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockQueue = jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
}));

jest.mock('bullmq', () => ({
    Queue: mockQueue,
}));

import { QueueService } from '../../src/services/QueueService';

describe('QueueService', () => {
    let service: QueueService;
    let mockRedis: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockRedis = {
            connection: {
                status: 'ready',
            },
        };

        mockQueueAdd.mockResolvedValue({ id: 'job-123' });

        service = new QueueService();
        (service as any).redis = mockRedis;
    });

    describe('$onInit', () => {
        it('should initialize BullMQ queue with Redis connection', () => {
            service.$onInit();

            expect(mockQueue).toHaveBeenCalledWith('ralph-tasks', {
                connection: mockRedis.connection,
            });
        });

        it('should log initialization', () => {
            const loggerSpy = jest.spyOn((service as any).logger, 'info');

            service.$onInit();

            expect(loggerSpy).toHaveBeenCalledWith('BullMQ Queue initialized');
        });
    });

    describe('$onDestroy', () => {
        it('should close queue on destroy', async () => {
            service.$onInit();

            await service.$onDestroy();

            expect(mockQueueClose).toHaveBeenCalled();
        });

        it('should log closure', async () => {
            service.$onInit();
            const loggerSpy = jest.spyOn((service as any).logger, 'info');

            await service.$onDestroy();

            expect(loggerSpy).toHaveBeenCalledWith('BullMQ Queue closed');
        });
    });

    describe('getQueue', () => {
        it('should return queue instance', () => {
            service.$onInit();

            const queue = service.getQueue();

            expect(queue).toBeDefined();
            expect(queue).toHaveProperty('add');
            expect(queue).toHaveProperty('close');
        });
    });

    describe('enqueueIssue', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should enqueue issue with correct job data', async () => {
            const issueData = {
                ticketId: 'ISSUE-123',
                title: 'Test issue',
                description: 'Description',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-123',
            };

            const result = await service.enqueueIssue(issueData);

            expect(mockQueueAdd).toHaveBeenCalledWith('coding-task', issueData, {
                jobId: 'ISSUE-123',
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: true,
                removeOnFail: true,
            });

            expect(result).toEqual({
                status: 'issue_queued',
                jobId: 'ISSUE-123',
            });
        });

        it('should log enqueue operations', async () => {
            const loggerSpy = jest.spyOn((service as any).logger, 'info');

            await service.enqueueIssue({
                ticketId: 'ISSUE-123',
                title: 'Test',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-123',
            });

            expect(loggerSpy).toHaveBeenCalledWith('Adding issue job to queue (ID: ISSUE-123)');
            expect(loggerSpy).toHaveBeenCalledWith('Successfully enqueued issue job ISSUE-123');
        });
    });

    describe('enqueueExecution', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should enqueue execution with correct job ID suffix', async () => {
            const executionData = {
                ticketId: 'ISSUE-456',
                title: 'Execute plan',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-456',
                mode: 'execute-only' as const,
                existingPlan: 'Plan content',
            };

            const result = await service.enqueueExecution(executionData);

            expect(mockQueueAdd).toHaveBeenCalledWith('coding-task', executionData, {
                jobId: 'ISSUE-456-exec',
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: true,
                removeOnFail: true,
            });

            expect(result).toEqual({
                status: 'execution_queued',
                jobId: 'ISSUE-456-exec',
            });
        });

        it('should handle execution with isIteration flag', async () => {
            await service.enqueueExecution({
                ticketId: 'ISSUE-789',
                title: 'Iterate',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-789',
                mode: 'execute-only',
                existingPlan: 'Plan',
                isIteration: true,
            });

            expect(mockQueueAdd).toHaveBeenCalledWith(
                'coding-task',
                expect.objectContaining({
                    ticketId: 'ISSUE-789',
                    isIteration: true,
                }),
                expect.any(Object)
            );
        });
    });

    describe('enqueueReplanning', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should enqueue replanning with feedback', async () => {
            const replanData = {
                ticketId: 'ISSUE-101',
                title: 'Replan task',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-101',
                mode: 'plan-only' as const,
                additionalFeedback: 'Please add more tests',
            };

            const result = await service.enqueueReplanning(replanData);

            expect(mockQueueAdd).toHaveBeenCalledWith('coding-task', replanData, {
                jobId: 'ISSUE-101-replan',
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: true,
                removeOnFail: true,
            });

            expect(result).toEqual({
                status: 'replanning_queued',
                jobId: 'ISSUE-101-replan',
            });
        });
    });

    describe('enqueueIteration', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should enqueue iteration with correct job ID', async () => {
            const iterationData = {
                ticketId: 'ISSUE-202',
                title: 'Fix PR',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-202',
                mode: 'plan-only' as const,
                additionalFeedback: 'Fix formatting',
                isIteration: true as const,
            };

            const result = await service.enqueueIteration(iterationData);

            expect(mockQueueAdd).toHaveBeenCalledWith('coding-task', iterationData, {
                jobId: 'ISSUE-202-iterate',
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: true,
                removeOnFail: true,
            });

            expect(result).toEqual({
                status: 'iteration_queued',
                jobId: 'ISSUE-202-iterate',
            });
        });

        it('should log iteration enqueue', async () => {
            const loggerSpy = jest.spyOn((service as any).logger, 'info');

            await service.enqueueIteration({
                ticketId: 'ISSUE-303',
                title: 'Fix',
                repoUrl: 'https://github.com/test/repo',
                branchName: 'ralph/feat-ISSUE-303',
                mode: 'plan-only',
                additionalFeedback: 'Feedback',
                isIteration: true,
            });

            expect(loggerSpy).toHaveBeenCalledWith('Adding iteration job to queue (ID: ISSUE-303-iterate)');
            expect(loggerSpy).toHaveBeenCalledWith('Successfully enqueued iteration job ISSUE-303-iterate');
        });
    });

    describe('Error handling', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should propagate queue.add errors', async () => {
            mockQueueAdd.mockRejectedValueOnce(new Error('Redis connection lost'));

            await expect(
                service.enqueueIssue({
                    ticketId: 'ISSUE-999',
                    title: 'Test',
                    repoUrl: 'https://github.com/test/repo',
                    branchName: 'ralph/feat-ISSUE-999',
                })
            ).rejects.toThrow('Redis connection lost');
        });
    });
});
