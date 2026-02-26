// Mock config/env with dynamic values
let mockPlanReviewEnabled = true;
jest.mock('../../src/config/env', () => ({
    get PLAN_REVIEW_ENABLED() {
        return mockPlanReviewEnabled;
    },
    CLAUDE_CACHE_PATH: '/tmp/claude-cache',
    PLAN_TTL_DAYS: 7,
}));

// Mock Ts.ED decorators
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
    Inject: () => (target: any, propertyKey: string) => {},
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock child_process
const mockSpawnOn = jest.fn();
const mockStdoutOn = jest.fn();
const mockStderrOn = jest.fn();
const mockStdinEnd = jest.fn();

const mockSpawn = jest.fn().mockImplementation(() => ({
    stdout: { on: mockStdoutOn },
    stderr: { on: mockStderrOn },
    stdin: { end: mockStdinEnd },
    on: mockSpawnOn,
    pid: 12345,
}));

jest.mock('node:child_process', () => ({
    spawn: mockSpawn,
}));

// Mock fs/promises
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue(''),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    cp: jest.fn().mockResolvedValue(undefined),
}));

// Mock fs
jest.mock('node:fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    default: {
        existsSync: jest.fn().mockReturnValue(true),
        mkdirSync: jest.fn(),
    },
}));

// Mock domain modules
jest.mock('../../src/domain/WorkspaceManager', () => ({
    setupWorkspace: jest.fn().mockResolvedValue({
        workDir: '/tmp/test-workspace',
        rootDir: '/tmp/test-workspace',
        git: {
            add: jest.fn().mockResolvedValue(undefined),
            commit: jest.fn().mockResolvedValue(undefined),
            push: jest.fn().mockResolvedValue(undefined),
            status: jest.fn().mockResolvedValue({
                staged: ['src/test.ts'],
                modified: [],
                created: [],
                deleted: []
            }),
        },
        cleanup: jest.fn().mockResolvedValue(undefined),
    }),
    parseRepoUrl: jest.fn().mockReturnValue({ owner: 'test', repo: 'repo' }),
}));

jest.mock('../../src/domain/AgentTools', () => ({
    detectProjectLanguages: jest.fn().mockResolvedValue(['TypeScript']),
    runPolyglotValidation: jest.fn().mockResolvedValue({
        success: true,
        output: 'Validation passed',
        changedFiles: ['src/test.ts'],
    }),
}));

jest.mock('../../src/domain/PlanFormatter', () => ({
    formatPlanForLinear: jest.fn().mockReturnValue('## Plan\nTest plan'),
}));

import { AgentOrchestratorService, Task, RateLimitError } from '../../src/services/AgentOrchestratorService';
import { setupWorkspace } from '../../src/domain/WorkspaceManager';
import { runPolyglotValidation } from '../../src/domain/AgentTools';

describe('AgentOrchestratorService', () => {
    let service: AgentOrchestratorService;
    let mockPlanStore: any;
    let mockLinear: any;
    let mockGithub: any;
    let mockLangfuse: any;

    const createMockTask = (overrides: Partial<Task> = {}): Task => ({
        ticketId: 'TEST-123',
        title: 'Test task',
        description: 'Test description',
        repoUrl: 'https://github.com/test/repo',
        branchName: 'ralph/feat-TEST-123',
        jobId: 'job-123',
        attempt: 1,
        maxAttempts: 3,
        mode: 'full',
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock services
        mockPlanStore = {
            storePlan: jest.fn().mockResolvedValue(undefined),
            getPlan: jest.fn().mockResolvedValue(null),
            deletePlan: jest.fn().mockResolvedValue(undefined),
        };

        mockLinear = {
            postComment: jest.fn().mockResolvedValue(undefined),
            updateIssueState: jest.fn().mockResolvedValue(true),
            updateIssueWithComment: jest.fn().mockResolvedValue(undefined),
            getIssueState: jest.fn().mockResolvedValue('In Progress'), // Before PR, then switches to In Review
            isEnabled: jest.fn().mockReturnValue(true),
        };

        mockGithub = {
            createPullRequest: jest.fn().mockResolvedValue('https://github.com/test/repo/pull/1'),
            generatePRDescription: jest.fn().mockResolvedValue('PR description'),
        };

        mockLangfuse = {
            withTrace: jest.fn().mockImplementation(async (name, metadata, fn) => {
                const trace = {
                    span: jest.fn().mockImplementation((arg1: any, arg2?: any, arg3?: any) => {
                        const spanObj = {
                            end: jest.fn(),
                        };

                        // Support both: span({name, metadata}) and span(name, metadata, fn)
                        if (typeof arg1 === 'object' && !arg2) {
                            // Object style: trace.span({ name, metadata })
                            return spanObj;
                        } else if (typeof arg3 === 'function') {
                            // Callback style: trace.span(name, metadata, fn)
                            return arg3(spanObj);
                        } else {
                            return spanObj;
                        }
                    }),
                };
                return fn(trace);
            }),
        };

        // Create service and inject mocks
        service = new AgentOrchestratorService();
        (service as any).planStore = mockPlanStore;
        (service as any).linear = mockLinear;
        (service as any).github = mockGithub;
        (service as any).langfuse = mockLangfuse;

        // Setup spawn mock to simulate successful Claude execution
        mockSpawnOn.mockImplementation((event, callback) => {
            if (event === 'close') {
                setTimeout(() => callback(0), 10);
            }
        });

        mockStdoutOn.mockImplementation((event, callback) => {
            if (event === 'data') {
                setTimeout(() => callback(Buffer.from('Claude output\n')), 5);
            }
        });

        mockStderrOn.mockImplementation((event, callback) => {
            // No errors
        });
    });

    describe('Constructor', () => {
        it('should create cache directory if it does not exist', () => {
            const fs = require('node:fs');
            fs.existsSync.mockReturnValueOnce(false);

            void new AgentOrchestratorService();

            expect(fs.mkdirSync).toHaveBeenCalled();
        });

        it('should handle cache directory creation errors gracefully', () => {
            const fs = require('node:fs');
            fs.existsSync.mockReturnValueOnce(false);
            fs.mkdirSync.mockImplementationOnce(() => {
                throw new Error('Permission denied');
            });

            expect(() => new AgentOrchestratorService()).not.toThrow();
        });
    });

    describe('runAgent - plan-only mode', () => {
        beforeEach(() => {
            mockPlanReviewEnabled = true;
        });

        it('should generate and store plan without execution', async () => {
            const task = createMockTask({ mode: 'full' });

            await service.runAgent(task);

            expect(mockPlanStore.storePlan).toHaveBeenCalled();
            expect(mockLinear.postComment).toHaveBeenCalled();
            expect(mockLinear.updateIssueState).toHaveBeenCalledWith('TEST-123', 'Todo');
            expect(mockGithub.createPullRequest).not.toHaveBeenCalled();
        });

        it('should handle plan generation errors', async () => {
            const task = createMockTask({ mode: 'plan-only' });

            mockSpawnOn.mockImplementation((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(1), 10); // Exit with error
                }
            });

            await expect(service.runAgent(task)).rejects.toThrow();
        });
    });

    describe('runAgent - execute-only mode', () => {
        it('should execute existing plan and create PR', async () => {
            const task = createMockTask({
                mode: 'execute-only',
                existingPlan: 'Existing plan content',
            });

            await service.runAgent(task);

            expect(mockGithub.createPullRequest).toHaveBeenCalled();
            // Since getIssueState returns "In Progress", it should update state
            expect(mockLinear.updateIssueWithComment).toHaveBeenCalledWith(
                'TEST-123',
                'In Review',
                expect.stringContaining('Done. PR:')
            );
            expect(mockPlanStore.deletePlan).toHaveBeenCalledWith('TEST-123');
        });

        it('should handle validation failures without retries', async () => {
            const task = createMockTask({
                mode: 'execute-only',
                existingPlan: 'Plan',
            });

            (runPolyglotValidation as jest.Mock).mockResolvedValue({
                success: false,
                output: 'Validation error',
                changedFiles: ['test.ts']
            });

            await service.runAgent(task);

            // Execute-only mode doesn't retry - just reports failure
            expect(runPolyglotValidation).toHaveBeenCalledTimes(1);
            expect(mockGithub.createPullRequest).not.toHaveBeenCalled();
            expect(mockLinear.updateIssueWithComment).toHaveBeenCalledWith(
                'TEST-123',
                'Todo',
                expect.stringContaining('validation failed')
            );
        });

    });

    describe('runAgent - full mode', () => {
        beforeEach(() => {
            mockPlanReviewEnabled = false;

            // Reset runPolyglotValidation to return success
            (runPolyglotValidation as jest.Mock).mockResolvedValue({
                success: true,
                output: 'Validation passed',
                changedFiles: ['src/test.ts'],
            });
        });

        it('should execute full workflow: plan + execute + PR', async () => {
            const task = createMockTask({ mode: 'full' });

            await service.runAgent(task);

            expect(setupWorkspace).toHaveBeenCalled();
            expect(mockSpawn).toHaveBeenCalled();
            expect(runPolyglotValidation).toHaveBeenCalled();
            expect(mockGithub.generatePRDescription).toHaveBeenCalled();
            expect(mockGithub.createPullRequest).toHaveBeenCalled();
            // Note: updateIssueState might not be called if Linear auto-switched
            expect(mockLinear.updateIssueWithComment).toHaveBeenCalled();
        });
    });

    describe('runAgent - iteration mode', () => {
        it('should handle PR iteration with existing workspace', async () => {
            const task = createMockTask({
                isIteration: true,
                description: 'Fix the formatting',
            });

            await service.runAgent(task);

            expect(setupWorkspace).toHaveBeenCalled();
            expect(mockSpawn).toHaveBeenCalled();
            expect(runPolyglotValidation).toHaveBeenCalled();
        });
    });

    describe('Rate limiting', () => {
        it('should detect and throw RateLimitError on 429 response', async () => {
            const task = createMockTask();

            mockStderrOn.mockImplementation((event, callback) => {
                if (event === 'data') {
                    setTimeout(() => callback(Buffer.from('Error: 429 Too Many Requests\n')), 5);
                }
            });

            mockSpawnOn.mockImplementation((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(1), 10);
                }
            });

            await expect(service.runAgent(task)).rejects.toThrow(RateLimitError);
        });

        it('should detect rate limit from overloaded message', async () => {
            const task = createMockTask();

            mockStderrOn.mockImplementation((event, callback) => {
                if (event === 'data') {
                    setTimeout(() => callback(Buffer.from('Error: rate limit exceeded\n')), 5);
                }
            });

            mockSpawnOn.mockImplementation((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(1), 10);
                }
            });

            await expect(service.runAgent(task)).rejects.toThrow(RateLimitError);
        });
    });

    describe('Error handling', () => {
        it('should handle workspace setup failures', async () => {
            const task = createMockTask();

            (setupWorkspace as jest.Mock).mockRejectedValueOnce(
                new Error('Git clone failed')
            );

            await expect(service.runAgent(task)).rejects.toThrow('Git clone failed');
        });

        it('should handle GitHub PR creation failures', async () => {
            const task = createMockTask({ mode: 'full' });

            // Make validation pass so it tries to create PR
            (runPolyglotValidation as jest.Mock).mockResolvedValue({
                success: true,
                output: 'OK',
                changedFiles: ['test.ts']
            });

            mockGithub.createPullRequest.mockRejectedValueOnce(
                new Error('PR creation failed')
            );

            await expect(service.runAgent(task)).rejects.toThrow('PR creation failed');
        });

        it('should cleanup workspace on error', async () => {
            const task = createMockTask();
            const mockCleanup = jest.fn();

            (setupWorkspace as jest.Mock).mockResolvedValueOnce({
                workDir: '/tmp/test',
                rootDir: '/tmp/test',
                git: {},
                cleanup: mockCleanup,
            });

            mockSpawnOn.mockImplementation((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(1), 10);
                }
            });

            await expect(service.runAgent(task)).rejects.toThrow();

            // Cleanup should be called even on error
            expect(mockCleanup).toHaveBeenCalled();
        });
    });

    describe('RateLimitError', () => {
        it('should have correct name property', () => {
            const error = new RateLimitError('Test rate limit');
            expect(error.name).toBe('RateLimitError');
            expect(error.message).toBe('Test rate limit');
        });
    });
});
