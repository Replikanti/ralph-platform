jest.mock('../src/workspace');
jest.mock('../src/tools');
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
}));

// Mock child_process for CLI execution
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

        // Setup Exec Mock
        mockExec.mockImplementation((cmd: string, opts: any, callback: any) => {
            callback(null, { stdout: 'Claude finished', stderr: '' });
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

    it('should execute claude CLI with prompt and skills', async () => {
        // Mock fs to simulate existing skills
        const fsModule = require('node:fs/promises');
        fsModule.access.mockResolvedValue(undefined);
        fsModule.readdir.mockResolvedValue(['react.md']);
        fsModule.readFile.mockResolvedValue('Always use functional components.');

        const task = {
            ticketId: '1',
            title: 'Test Task',
            description: 'Do something',
            repoUrl: 'https://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        // Verify CLI execution
        expect(mockExec).toHaveBeenCalled();
        const cmd = mockExec.mock.calls[0][0];
        const options = mockExec.mock.calls[0][1];

        expect(cmd).toContain('claude -p');
        expect(cmd).toContain('Task: Test Task');
        expect(cmd).toContain('Always use functional components');
        expect(cmd).toContain('--allowedTools "Bash,Read,Edit,FileSearch,Glob"');
        
        expect(options.cwd).toBe('/mock/workspace');
        
        // Verify Git operations
        expect(mockGit.push).toHaveBeenCalledWith('origin', task.branchName);
    });

    it('should handle CLI errors gracefully', async () => {
        mockExec.mockImplementation((cmd: string, opts: any, callback: any) => {
            const error: any = new Error('CLI Failed');
            error.stderr = 'Syntax Error';
            callback(error, null);
        });

        const task = { ticketId: 'error', title: 'Fail Task' };

        await expect(runAgent(task)).rejects.toThrow('CLI Failed');

        expect(mockTraceUpdate).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ error: 'CLI Failed' })
        }));
    });

    it('should commit with WIP if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
        });

        const task = { ticketId: '1', title: 'Validation Fail' };
        await runAgent(task);

        expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining('wip:'));
    });
});