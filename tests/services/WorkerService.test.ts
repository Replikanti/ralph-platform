// Mock Ts.ED decorators before imports
import { mockTsEdDecorators } from '../test-utils/common-mocks';

const mocks = mockTsEdDecorators();
jest.mock('@tsed/common', () => ({
    ...mocks['@tsed/common'],
    OnInit: jest.fn(),
    OnDestroy: jest.fn(),
}));
jest.mock('@tsed/logger', () => mocks['@tsed/logger']);

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

function createMockJob(data: any, overrides: any = {}) {
    return {
        id: '123',
        data,
        attemptsMade: 0,
        opts: { attempts: 3 },
        ...overrides,
    };
}

function getProcessJobFn() {
    const workerConstructorCall = (Worker as unknown as jest.Mock).mock.calls[0];
    return workerConstructorCall[1];
}

function getEventHandler(eventName: string) {
    const call = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === eventName);
    return call[1];
}

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
            const mockJob = createMockJob({ ticketId: 'TICKET-1', mode: 'full' });
            const processJobFn = getProcessJobFn();

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

            const mockJob = createMockJob(
                { ticketId: 'TICKET-1' },
                { moveToDelayed: mockMoveToDelayed, token: 'test-token' }
            );
            const processJobFn = getProcessJobFn();

            await processJobFn(mockJob);

            expect(mockMoveToDelayed).toHaveBeenCalledWith(
                expect.any(Number),
                'test-token'
            );
        });

        it('should rethrow non-rate-limit errors', async () => {
            const normalError = new Error('Some other error');
            mockOrchestrator.runAgent.mockRejectedValueOnce(normalError);

            const mockJob = createMockJob({ ticketId: 'TICKET-1' });
            const processJobFn = getProcessJobFn();

            await expect(processJobFn(mockJob)).rejects.toThrow('Some other error');
        });
    });

    describe('onCompleted', () => {
        beforeEach(() => {
            service.$onInit();
        });

        test.each([
            ['execute-only', true],
            ['full', true],
            ['plan-only', false],
        ])('should %s set tombstone for %s jobs', async (mode, shouldSet) => {
            const mockJob = createMockJob({ ticketId: 'TICKET-1', mode });
            const onCompletedFn = getEventHandler('completed');

            await onCompletedFn(mockJob);

            if (shouldSet) {
                expect(mockRedis.connection.set).toHaveBeenCalledWith(
                    'ralph:tombstone:TICKET-1',
                    'true',
                    'EX',
                    31536000
                );
            } else {
                expect(mockRedis.connection.set).not.toHaveBeenCalled();
            }
        });
    });

    describe('onFailed', () => {
        beforeEach(() => {
            service.$onInit();
        });

        test.each([
            ['exhausted attempts', 3, true],
            ['non-final failures', 1, false],
        ])('should %s report to Linear on %s', async (_, attemptsMade, shouldReport) => {
            const mockJob = createMockJob({ ticketId: 'TICKET-1' }, { attemptsMade });
            const mockError = new Error('Test error');
            const onFailedFn = getEventHandler('failed');

            await onFailedFn(mockJob, mockError);

            if (shouldReport) {
                expect(mockLinear.updateIssueWithComment).toHaveBeenCalledWith(
                    'TICKET-1',
                    'Todo',
                    expect.stringContaining('failed permanently after 3 attempts')
                );
            } else {
                expect(mockLinear.updateIssueWithComment).not.toHaveBeenCalled();
            }
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
