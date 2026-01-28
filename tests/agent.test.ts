jest.mock('../src/workspace');
jest.mock('../src/tools');
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ mtimeMs: Date.now() }),
}));

// Set a longer timeout for agent tests involving CLI mocks
jest.setTimeout(30000);

// Mock child_process for spawn and exec
const mockSpawnOn = jest.fn();
const mockStdoutOn = jest.fn();
const mockStderrOn = jest.fn();

const mockSpawn = jest.fn().mockImplementation(() => ({
    stdout: { on: mockStdoutOn },
    stderr: { on: mockStderrOn },
    on: mockSpawnOn
}));

const mockExec = jest.fn();

jest.mock('node:child_process', () => ({
    spawn: mockSpawn,
    exec: mockExec
}));

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

        // Default spawn behavior
        mockSpawnOn.mockImplementation((event, cb) => {
            if (event === 'close') cb(0);
        });
        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('Default Output'));
        });
        
        // Default exec behavior
        mockExec.mockImplementation((cmd, opts, cb) => {
            const callback = typeof opts === 'function' ? opts : cb;
            callback(null, { stdout: '', stderr: '' });
        });

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

        // Mock sequence of outputs
        mockStdoutOn
            .mockImplementationOnce((event, cb) => { if (event === 'data') cb(Buffer.from('<plan>Do X</plan>')); }) // Plan Phase
            .mockImplementationOnce((event, cb) => { if (event === 'data') cb(Buffer.from('Implementation done')); }); // Execute Phase

        const task = { ticketId: '123', title: 'Test', description: 'Desc' };
        await runAgent(task);

        expect(mockSpawn).toHaveBeenCalledWith(
            'claude',
            expect.arrayContaining(['--model', 'opus-4-5']),
            expect.anything()
        );

        expect(mockSpawn).toHaveBeenCalledWith(
            'claude',
            expect.arrayContaining(['--model', 'sonnet-4-5']),
            expect.objectContaining({ cwd: '/mock/workspace' })
        );
    });

    it('should retry if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock)
            .mockResolvedValueOnce({ success: false, output: 'Linter error' })
            .mockResolvedValueOnce({ success: true, output: 'Fixed' });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Try</plan>'));
        });

        await runAgent({ ticketId: 'retry', title: 'Retry Task' });
        expect(mockSpawn.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should commit with WIP if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
        });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Fail</plan>'));
        });

        const task = { ticketId: '1', title: 'Validation Fail' };
        await runAgent(task);
        expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining('wip:'));
    });
});
