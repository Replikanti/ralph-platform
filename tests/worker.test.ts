import { createWorker, jobProcessor } from '../src/worker';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent } from '../src/agent';

jest.mock('bullmq');
jest.mock('ioredis');
jest.mock('../src/agent');

describe('Worker', () => {
    it('should create a worker with correct options', () => {
        createWorker();
        
        expect(Worker).toHaveBeenCalledWith(
            'ralph-tasks', 
            jobProcessor, 
            expect.objectContaining({
                concurrency: 2,
                limiter: { max: 5, duration: 60000 },
                connection: expect.any(IORedis)
            })
        );
    });

    it('should process job by calling runAgent', async () => {
        const mockJob = { id: '123', data: { task: 'test' } };
        await jobProcessor(mockJob);
        expect(runAgent).toHaveBeenCalledWith(mockJob.data);
    });
});
