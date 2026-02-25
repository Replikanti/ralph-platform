// Mock Ts.ED decorators before imports
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
    Inject: () => (target: any, propertyKey: string) => {},
    OnInit: jest.fn(),
    OnDestroy: jest.fn(),
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock BullMQ Worker
const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockMoveToDelayed = jest.fn().mockResolvedValue(undefined);

jest.mock('bullmq', () => ({
    Worker: jest.fn().mockImplementation(() => ({
        on: mockWorkerOn,
        close: mockWorkerClose,
    })),
}));

import { WorkerService } from '../../src/services/WorkerService';
import { Worker } from 'bullmq';

describe('WorkerService', () => {
    let service: WorkerService;
    let mockRedis: any;
    let mockOrchestrator: any;
    let mockLinear: any;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock dependencies
        mockRedis = {
            connection: {
                set: jest.fn().mockResolvedValue('OK'),
            },
        };

        mockOrchestrator = {
            runAgent: jest.fn().mockResolvedValue(undefined),
        };

        mockLinear = {
            updateIssueWithComment: jest.fn().mockResolvedValue(undefined),
        };

        // Create service and inject mocks
        service = new WorkerService();
        (service as any).redis = mockRedis;
        (service as any).orchestrator = mockOrchestrator;
        (service as any).linear = mockLinear;
    });

    describe('$onInit', () => {
        it('should create worker with correct configuration', () => {
            service.$onInit();

            expect(Worker).toHaveBeenCalledWith(
                'ralph-tasks',
                expect.any(Function),
                expect.objectContaining({
                    connection: mockRedis.connection,
                    concurrency: 1,
                    limiter: { max: 10, duration: 60000 },
                    lockDuration: 600000,
                    lockRenewTime: 30000,
                })
            );

            expect(mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function));
            expect(mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function));
        });
    });

    describe('processJob', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should process job by calling runAgent', async () => {
            const mockJob = {
                id: '123',
                data: {
                    ticketId: 'TICKET-1',
                    mode: 'full'
                },
                attemptsMade: 0,
                opts: { attempts: 3 },
            };

            // Get the processJob function passed to Worker constructor
            const workerConstructorCall = (Worker as unknown as jest.Mock).mock.calls[0];
            const processJobFn = workerConstructorCall[1];

            await processJobFn(mockJob);

            expect(mockOrchestrator.runAgent).toHaveBeenCalledWith({
                ticketId: 'TICKET-1',
                jobId: '123',
                attempt: 1,
                maxAttempts: 3,
                mode: 'full',
                existingPlan: undefined,
                additionalFeedback: undefined,
            });
        });

        it('should handle rate limit errors by moving job to delayed', async () => {
            const rateLimitError = new Error('Rate limit exceeded');
            rateLimitError.name = 'RateLimitError';
            mockOrchestrator.runAgent.mockRejectedValueOnce(rateLimitError);

            const mockJob = {
                id: '123',
                data: { ticketId: 'TICKET-1' },
                attemptsMade: 0,
                opts: { attempts: 3 },
                moveToDelayed: mockMoveToDelayed,
                token: 'test-token',
            };

            const workerConstructorCall = (Worker as unknown as jest.Mock).mock.calls[0];
            const processJobFn = workerConstructorCall[1];

            await processJobFn(mockJob);

            expect(mockMoveToDelayed).toHaveBeenCalledWith(
                expect.any(Number),
                'test-token'
            );
        });

        it('should rethrow non-rate-limit errors', async () => {
            const normalError = new Error('Some other error');
            mockOrchestrator.runAgent.mockRejectedValueOnce(normalError);

            const mockJob = {
                id: '123',
                data: { ticketId: 'TICKET-1' },
                attemptsMade: 0,
                opts: { attempts: 3 },
            };

            const workerConstructorCall = (Worker as unknown as jest.Mock).mock.calls[0];
            const processJobFn = workerConstructorCall[1];

            await expect(processJobFn(mockJob)).rejects.toThrow('Some other error');
        });
    });

    describe('onCompleted', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should set tombstone for execute-only jobs', async () => {
            const mockJob = {
                id: '123',
                data: {
                    ticketId: 'TICKET-1',
                    mode: 'execute-only',
                },
            };

            // Get the onCompleted handler
            const completedCall = mockWorkerOn.mock.calls.find((call: any[]) => call[0] === 'completed');
            const onCompletedFn = completedCall[1];

            await onCompletedFn(mockJob);

            expect(mockRedis.connection.set).toHaveBeenCalledWith(
                'ralph:tombstone:TICKET-1',
                'true',
                'EX',
                31536000
            );
        });

        it('should set tombstone for full jobs', async () => {
            const mockJob = {
                id: '123',
                data: {
                    ticketId: 'TICKET-1',
                    mode: 'full',
                },
            };

            const completedCall = mockWorkerOn.mock.calls.find((call: any[]) => call[0] === 'completed');
            const onCompletedFn = completedCall[1];

            await onCompletedFn(mockJob);

            expect(mockRedis.connection.set).toHaveBeenCalledWith(
                'ralph:tombstone:TICKET-1',
                'true',
                'EX',
                31536000
            );
        });

        it('should not set tombstone for plan-only jobs', async () => {
            const mockJob = {
                id: '123',
                data: {
                    ticketId: 'TICKET-1',
                    mode: 'plan-only',
                },
            };

            const completedCall = mockWorkerOn.mock.calls.find((call: any[]) => call[0] === 'completed');
            const onCompletedFn = completedCall[1];

            await onCompletedFn(mockJob);

            expect(mockRedis.connection.set).not.toHaveBeenCalled();
        });
    });

    describe('onFailed', () => {
        beforeEach(() => {
            service.$onInit();
        });

        it('should report permanent failure to Linear after exhausted attempts', async () => {
            const mockJob = {
                id: '123',
                data: { ticketId: 'TICKET-1' },
                attemptsMade: 3,
                opts: { attempts: 3 },
            };
            const mockError = new Error('Final error');

            const failedCall = mockWorkerOn.mock.calls.find((call: any[]) => call[0] === 'failed');
            const onFailedFn = failedCall[1];

            await onFailedFn(mockJob, mockError);

            expect(mockLinear.updateIssueWithComment).toHaveBeenCalledWith(
                'TICKET-1',
                'Todo',
                expect.stringContaining('failed permanently after 3 attempts')
            );
        });

        it('should not report to Linear on non-final failures', async () => {
            const mockJob = {
                id: '123',
                data: { ticketId: 'TICKET-1' },
                attemptsMade: 1,
                opts: { attempts: 3 },
            };
            const mockError = new Error('Temporary error');

            const failedCall = mockWorkerOn.mock.calls.find((call: any[]) => call[0] === 'failed');
            const onFailedFn = failedCall[1];

            await onFailedFn(mockJob, mockError);

            expect(mockLinear.updateIssueWithComment).not.toHaveBeenCalled();
        });
    });

    describe('$onDestroy', () => {
        it('should close worker gracefully', async () => {
            service.$onInit();

            await service.$onDestroy();

            expect(mockWorkerClose).toHaveBeenCalled();
        });
    });
});
