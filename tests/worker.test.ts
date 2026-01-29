process.env.LINEAR_API_KEY = 'test-key';

import { createWorker, jobProcessor } from '../src/worker';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent } from '../src/agent';

jest.mock('bullmq');
jest.mock('ioredis');
jest.mock('../src/agent');

describe('Worker', () => {
    let mockOn: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockOn = jest.fn();
        (Worker as unknown as jest.Mock).mockImplementation(() => ({
            on: mockOn,
            close: jest.fn(),
        }));
    });

    it('should create a worker with correct options and register event listeners', () => {
        createWorker();
        
        expect(Worker).toHaveBeenCalledWith(
            'ralph-tasks', 
            jobProcessor, 
            expect.objectContaining({
                concurrency: 1,
                limiter: { max: 10, duration: 60000 },
                connection: expect.any(IORedis),
                lockDuration: 600000,
                lockRenewTime: 30000
            })
        );
        expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
        expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
    });

    it('should process job by calling runAgent', async () => {
        const mockJob = {
            id: '123',
            data: { task: 'test' },
            attemptsMade: 0,
            opts: { attempts: 3 }
        };
        await jobProcessor(mockJob as any);

        expect(runAgent).toHaveBeenCalledWith(
            {
                task: 'test',
                jobId: '123',
                attempt: 1,
                maxAttempts: 3,
                mode: 'full',
                existingPlan: undefined,
                additionalFeedback: undefined
            },
            expect.any(IORedis)
        );
    });

    it('should log on completed event', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        createWorker();

        const completedHandler = mockOn.mock.calls.find(call => call[0] === 'completed')[1];
        completedHandler({ id: '123', data: { ticketId: 'TICKET-1' } });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Job 123 completed'));
        consoleSpy.mockRestore();
    });

    it('should log failure and critical failure on exhausted attempts', () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        createWorker();

        const failedHandler = mockOn.mock.calls.find(call => call[0] === 'failed')[1];
        
        // Test normal failure
        failedHandler(
            { id: '123', attemptsMade: 1, opts: { attempts: 3 } }, 
            new Error('Some error')
        );
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Job 123 failed (Attempt 1/3)'));

        // Test critical failure (exhausted attempts)
        failedHandler(
            { id: '123', attemptsMade: 3, opts: { attempts: 3 } }, 
            new Error('Final error')
        );
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Job 123 FAILED PERMANENTLY'));
        
        errorSpy.mockRestore();
    });
});