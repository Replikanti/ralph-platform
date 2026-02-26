process.env.LINEAR_API_KEY = 'test-key';

import { createWorker, jobProcessor } from '../src/worker';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { runAgent } from '../src/agent';

jest.mock('bullmq');
jest.mock('ioredis');
jest.mock('../src/agent');
jest.mock('../src/plan-store');
jest.mock('../src/plan-formatter');

const mockUpdateIssueState = jest.fn().mockResolvedValue(true);
const mockPostComment = jest.fn().mockResolvedValue(undefined);
const mockGetIssueState = jest.fn().mockResolvedValue('Todo');

jest.mock('../src/linear-client', () => ({
    LinearClient: jest.fn().mockImplementation(() => ({
        updateIssueState: mockUpdateIssueState,
        postComment: mockPostComment,
        getIssueState: mockGetIssueState,
    }))
}));

jest.mock('../src/domain/agent-outcomes', () => ({
    resolvePlatformAction: jest.requireActual('../src/domain/agent-outcomes').resolvePlatformAction,
}));

const mockRunAgent = runAgent as jest.MockedFunction<typeof runAgent>;

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

    it('creates worker with correct options and registers event listeners', () => {
        createWorker();

        expect(Worker).toHaveBeenCalledWith(
            'ralph-tasks',
            jobProcessor,
            expect.objectContaining({
                concurrency: 1,
                limiter: { max: 10, duration: 60000 },
                connection: expect.any(IORedis),
                lockDuration: 600000,
                lockRenewTime: 30000,
            })
        );
        expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
        expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
    });

    it('calls runAgent without redis parameter', async () => {
        mockRunAgent.mockResolvedValue({ mode: 'full', status: 'executed', prUrl: 'https://github.com/org/repo/pull/1', isIteration: false });

        const mockJob = {
            id: '123',
            data: { ticketId: 'T-1', title: 'task', repoUrl: 'https://github.com/org/repo', branchName: 'b', mode: 'full' },
            attemptsMade: 0,
            opts: { attempts: 3 },
            token: 'token',
        };
        await jobProcessor(mockJob as any);

        expect(mockRunAgent).toHaveBeenCalledWith(
            expect.objectContaining({ ticketId: 'T-1', jobId: '123', attempt: 1, maxAttempts: 3 })
        );
        // Must NOT receive IORedis as second argument
        expect(mockRunAgent).not.toHaveBeenCalledWith(expect.anything(), expect.any(IORedis));
    });

    describe('pre-agent Linear notification', () => {
        it('notifies Linear with plan-in-progress message for plan-only mode', async () => {
            mockRunAgent.mockResolvedValue({ mode: 'plan-only', status: 'plan-generated', plan: 'the plan' });

            await jobProcessor({
                id: 'j1', data: { ticketId: 'T-1', title: 'task', repoUrl: 'r', branchName: 'b', mode: 'plan-only' },
                attemptsMade: 0, opts: { attempts: 3 }, token: 'tok',
            } as any);

            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-1', 'In Progress');
            expect(mockPostComment).toHaveBeenCalledWith('T-1', expect.stringContaining('generating implementation plan'));
        });

        it('notifies Linear with iteration message for plan-only + isIteration', async () => {
            mockRunAgent.mockResolvedValue({ mode: 'plan-only', status: 'plan-generated', plan: 'iteration plan' });

            await jobProcessor({
                id: 'j2', data: { ticketId: 'T-2', title: 't', repoUrl: 'r', branchName: 'b', mode: 'plan-only', isIteration: true },
                attemptsMade: 0, opts: { attempts: 3 }, token: 'tok',
            } as any);

            expect(mockPostComment).toHaveBeenCalledWith('T-2', expect.stringContaining('iteration plan'));
        });

        it('notifies Linear for execute-only mode', async () => {
            mockRunAgent.mockResolvedValue({ mode: 'execute-only', status: 'executed', prUrl: 'https://github.com/org/repo/pull/2', isIteration: false });

            await jobProcessor({
                id: 'j3', data: { ticketId: 'T-3', title: 't', repoUrl: 'r', branchName: 'b', mode: 'execute-only', existingPlan: 'plan' },
                attemptsMade: 0, opts: { attempts: 3 }, token: 'tok',
            } as any);

            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-3', 'In Progress');
        });
    });

    describe('handleAgentResult orchestration', () => {
        const baseJob = (ticketId: string, mode = 'full') => ({
            id: 'j', data: { ticketId, title: 'task', repoUrl: 'r', branchName: 'b', mode },
            attemptsMade: 0, opts: { attempts: 3 }, token: 'tok',
        });

        it('stores plan in Redis and posts to Linear on plan-generated', async () => {
            const { storePlan } = require('../src/plan-store');
            const { formatPlanForLinear } = require('../src/plan-formatter');
            (formatPlanForLinear as jest.Mock).mockReturnValue('## Formatted Plan');
            mockRunAgent.mockResolvedValue({ mode: 'plan-only', status: 'plan-generated', plan: 'raw plan' });

            await jobProcessor(baseJob('T-plan', 'plan-only') as any);

            expect(storePlan).toHaveBeenCalledWith(expect.any(IORedis), 'T-plan', expect.objectContaining({ plan: 'raw plan', taskId: 'T-plan' }));
            expect(mockPostComment).toHaveBeenCalledWith('T-plan', '## Formatted Plan');
            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-plan', 'Todo');
        });

        it('deletes plan and marks In Review on executed (non-iteration)', async () => {
            const { deletePlan } = require('../src/plan-store');
            mockGetIssueState.mockResolvedValue('In Review');
            mockRunAgent.mockResolvedValue({ mode: 'full', status: 'executed', prUrl: 'https://github.com/org/repo/pull/1', isIteration: false });

            await jobProcessor(baseJob('T-exec') as any);

            expect(deletePlan).toHaveBeenCalledWith(expect.any(IORedis), 'T-exec');
            expect(mockPostComment).toHaveBeenCalledWith('T-exec', expect.stringContaining('Done'));
        });

        it('does NOT delete plan and marks In Review on executed (iteration)', async () => {
            const { deletePlan } = require('../src/plan-store');
            mockRunAgent.mockResolvedValue({ mode: 'execute-only', status: 'executed', prUrl: null, isIteration: true });

            await jobProcessor(baseJob('T-iter', 'execute-only') as any);

            expect(deletePlan).not.toHaveBeenCalled();
            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-iter', 'In Review');
        });

        it('marks Todo on no-changes', async () => {
            mockRunAgent.mockResolvedValue({ mode: 'full', status: 'no-changes' });

            await jobProcessor(baseJob('T-nochange') as any);

            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-nochange', 'Todo');
            expect(mockPostComment).toHaveBeenCalledWith('T-nochange', expect.stringContaining('No changes'));
        });

        it('marks Todo with error comment on validation-failed', async () => {
            mockRunAgent.mockResolvedValue({
                mode: 'full',
                status: 'validation-failed',
                validationOutput: 'TSC error on line 5',
                failureSummary: 'Type mismatch in foo.ts',
            });

            await jobProcessor(baseJob('T-fail') as any);

            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-fail', 'Todo');
            expect(mockPostComment).toHaveBeenCalledWith('T-fail', expect.stringContaining('Type mismatch in foo.ts'));
        });
    });

    describe('rate limit handling', () => {
        it('delays job on RateLimitError instead of throwing', async () => {
            const rateLimitErr = new Error('Rate limit hit');
            rateLimitErr.name = 'RateLimitError';
            mockRunAgent.mockRejectedValue(rateLimitErr);

            const mockMoveToDelayed = jest.fn();
            const mockJob = {
                id: 'rl', data: { ticketId: 'T-rl', mode: 'full' },
                attemptsMade: 0, opts: { attempts: 3 }, token: 'tok',
                moveToDelayed: mockMoveToDelayed,
            };

            await expect(jobProcessor(mockJob as any)).resolves.not.toThrow();
            expect(mockMoveToDelayed).toHaveBeenCalled();
        });
    });

    describe('completed event', () => {
        it('sets tombstone for execute-only job', async () => {
            const mockSet = jest.fn();
            (IORedis as unknown as jest.Mock).mockImplementation(() => ({
                set: mockSet,
                on: jest.fn(),
                quit: jest.fn(),
            }));

            createWorker();
            const completedHandler = mockOn.mock.calls.find((c: any[]) => c[0] === 'completed')[1];
            await completedHandler({ id: '123', data: { ticketId: 'T-1', mode: 'execute-only' } });

            expect(mockSet).toHaveBeenCalledWith(
                'ralph:tombstone:T-1', 'true', 'EX', 31536000
            );
        });
    });

    describe('failed event', () => {
        it('logs failure and reports permanently failed job to Linear', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation();
            createWorker();

            const failedHandler = mockOn.mock.calls.find((c: any[]) => c[0] === 'failed')[1];

            await failedHandler(
                { id: '123', data: { ticketId: 'T-1' }, attemptsMade: 3, opts: { attempts: 3 } },
                new Error('Final error')
            );

            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED PERMANENTLY'));
            expect(mockUpdateIssueState).toHaveBeenCalledWith('T-1', 'Todo');
            errorSpy.mockRestore();
        });
    });
});
