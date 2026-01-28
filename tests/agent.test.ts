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
jest.setTimeout(15000);

// Mock child_process
const mockExec = jest.fn();
jest.mock('node:child_process', () => ({
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

        // Setup Exec Mock: standard callback signature (error, result)
        // promisify(exec) expects this. It needs to handle optional options.
        mockExec.mockImplementation((cmd: string, opts: any, callback: any) => {
            const cb = typeof opts === 'function' ? opts : callback;
            cb(null, { stdout: 'Default Output', stderr: '' });
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
        // Mock skills directory
        const fsModule = require('node:fs/promises');
        fsModule.readdir.mockResolvedValue(['code-style.md', 'db.md']);
        fsModule.readFile.mockResolvedValue('Skill content');

        // Mock sequence of exec calls (using standard callback signature)
        mockExec
            .mockImplementationOnce((cmd, opts, cb) => {
                const actualCb = typeof opts === 'function' ? opts : cb;
                actualCb(null, { stdout: '<plan>Do X</plan><skills>["code-style.md"]</skills>', stderr: '' });
            })
            .mockImplementationOnce((cmd, opts, cb) => {
                const actualCb = typeof opts === 'function' ? opts : cb;
                actualCb(null, { stdout: 'Implementation done', stderr: '' });
            });

        const task = { ticketId: '123', title: 'Test', description: 'Desc' };
        await runAgent(task);

        // Verify Opus was called for planning
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('--model opus-4-5'),
            expect.anything()
        );

        // Verify Sonnet was called for execution
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('--model sonnet-4-5'),
            expect.objectContaining({ cwd: '/mock/workspace' }),
            expect.anything()
        );

        // Verify skill loading (only the selected one)
        expect(fsModule.readFile).toHaveBeenCalledWith(expect.stringContaining('code-style.md'), 'utf-8');
        expect(fsModule.readFile).not.toHaveBeenCalledWith(expect.stringContaining('db.md'), 'utf-8');
    });

    it('should retry if validation fails', async () => {
        const toolsModule = require('../src/tools');
        
        // 1. First iteration fails validation
        // 2. Second iteration succeeds
        (toolsModule.runPolyglotValidation as jest.Mock)
            .mockResolvedValueOnce({ success: false, output: 'Linter error' })
            .mockResolvedValueOnce({ success: true, output: 'Fixed' });

        mockExec.mockImplementation((cmd, opts, cb) => {
            const actualCb = typeof opts === 'function' ? opts : cb;
            actualCb(null, { stdout: '<plan>Try</plan><skills>[]</skills>', stderr: '' });
        });

        await runAgent({ ticketId: 'retry', title: 'Retry Task' });

        // Should have iterated at least twice (4 calls total: 2 plan + 2 exec)
        expect(mockExec.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should commit with WIP if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
        });

        mockExec.mockImplementation((cmd, opts, cb) => {
            const actualCb = typeof opts === 'function' ? opts : cb;
            actualCb(null, { stdout: '<plan>Fail</plan><skills>[]</skills>', stderr: '' });
        });

        const task = { ticketId: '1', title: 'Validation Fail' };
        await runAgent(task);

        expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining('wip:'));
    });
});