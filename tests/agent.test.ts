jest.mock('../src/workspace');
jest.mock('../src/tools');
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
}));

// Set a longer timeout for agent tests involving CLI mocks
jest.setTimeout(30000);

// Mock child_process and util.promisify
const mockExec = jest.fn();
jest.mock('node:child_process', () => ({
    exec: jest.fn()
}));

jest.mock('node:util', () => {
    const originalUtil = jest.requireActual('node:util');
    return {
        ...originalUtil,
        promisify: (fn: any) => {
            if (fn === require('node:child_process').exec) {
                return mockExec;
            }
            return originalUtil.promisify(fn);
        }
    };
});

describe('runAgent', () => {
    let mockGit: any;
    let mockCleanup: any;
    let mockTraceSpan: any;
    let mockSpanEnd: any;
    let mockTraceUpdate: any;
    let mockLangfuseFlush: any;
    let runAgent: any;

    beforeEach(() => {
        jest.resetModules();

        mockGit = {
            add: jest.fn(),
            commit: jest.fn(),
            push: jest.fn(),
        };
        mockCleanup = jest.fn();

        // Re-require mocked modules
        const workspaceModule = require('../src/workspace');
        (workspaceModule.setupWorkspace as jest.Mock).mockResolvedValue({
            workDir: '/mock/workspace',
            git: mockGit,
            cleanup: mockCleanup,
        });

        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: true,
            output: 'Validation Passed',
        });

        // Default exec mock implementation (promise style because of promisify mock)
        mockExec.mockImplementation(() => Promise.resolve({ stdout: 'Default Output', stderr: '' }));

        // Setup Langfuse Mock
        mockSpanEnd = jest.fn();
        mockTraceSpan = jest.fn().mockReturnValue({ end: mockSpanEnd });
        mockTraceUpdate = jest.fn();
        mockLangfuseFlush = jest.fn();

        jest.doMock('langfuse', () => {
            return {
                Langfuse: jest.fn().mockImplementation(() => ({
                    trace: jest.fn().mockReturnValue({
                        span: mockTraceSpan,
                        update: mockTraceUpdate,
                        shutdownAsync: jest.fn(),
                    }),
                    flushAsync: mockLangfuseFlush,
                }))
            };
        });

        const agentModule = require('../src/agent');
        runAgent = agentModule.runAgent;
    });

    it('should run the iterative loop: Opus plans, Sonnet executes', async () => {
        const fsModule = require('node:fs/promises');
        fsModule.readdir.mockResolvedValue([{ name: 'security-audit', isDirectory: () => true }]);
        fsModule.readFile.mockResolvedValue('CLAUDE.md content');

        mockExec
            .mockResolvedValueOnce({ stdout: '<plan>Do X</plan>', stderr: '' })
            .mockResolvedValueOnce({ stdout: 'Implementation done', stderr: '' });

        const task = { ticketId: '123', title: 'Test', description: 'Desc' };
        await runAgent(task);

        // Verify Opus was called for planning
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('--model opus-4-5')
        );

        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('--model sonnet-4-5'),
            expect.objectContaining({ cwd: '/mock/workspace' })
        );

        expect(fsModule.readFile).toHaveBeenCalledWith(expect.stringContaining('CLAUDE.md'), 'utf-8');
    });

    it('should retry if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock)
            .mockResolvedValueOnce({ success: false, output: 'Linter error' })
            .mockResolvedValueOnce({ success: true, output: 'Fixed' });

        mockExec.mockResolvedValue({ stdout: '<plan>Try</plan>', stderr: '' });

        await runAgent({ ticketId: 'retry', title: 'Retry Task' });
        expect(mockExec.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should commit with WIP if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
        });

        mockExec.mockResolvedValue({ stdout: '<plan>Fail</plan>', stderr: '' });

        const task = { ticketId: '1', title: 'Validation Fail' };
        await runAgent(task);
        expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining('wip:'));
    });
});
