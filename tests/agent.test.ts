import { runAgent } from '../src/agent';

jest.mock('../src/workspace');
jest.mock('../src/tools');
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
}));

describe('runAgent', () => {
    let mockGit: any;
    let mockCleanup: any;
    let mockMessagesCreate: any;
    let mockTraceSpan: any;
    let mockTraceUpdate: any;
    let mockLangfuseFlush: any;
    let runAgent: any;

    beforeEach(() => {
        jest.resetModules(); // Reset cache to re-execute src/agent.ts top-level code

        mockGit = {
            add: jest.fn(),
            commit: jest.fn(),
            push: jest.fn(),
        };
        mockCleanup = jest.fn();

        // Re-require mocked modules to get the fresh mock references after resetModules()
        const workspaceModule = require('../src/workspace');
        (workspaceModule.setupWorkspace as jest.Mock).mockResolvedValue({
            workDir: '/tmp/test',
            git: mockGit,
            cleanup: mockCleanup,
        });

        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: true,
            output: 'Validation Passed',
        });

        // Setup Anthropic Mock
        mockMessagesCreate = jest.fn().mockResolvedValue({
            content: [{ text: 'Generated Plan/Code' }],
        });

        jest.doMock('@anthropic-ai/sdk', () => {
            return {
                Anthropic: jest.fn().mockImplementation(() => ({
                    messages: {
                        create: mockMessagesCreate,
                    }
                }))
            };
        });

        // Setup Langfuse Mock
        mockTraceSpan = jest.fn().mockReturnValue({ end: jest.fn() });
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

        // Import the module under test
        // We use require because we want to load it AFTER mocks are set up
        const agentModule = require('../src/agent');
        runAgent = agentModule.runAgent;
    });

    it('should run the full agent workflow successfully', async () => {
        const task = {
            ticketId: '1',
            title: 'Test Task',
            description: 'Do something',
            repoUrl: 'http://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        // We need to check against the mock function that was actually used
        const workspaceModule = require('../src/workspace');
        expect(workspaceModule.setupWorkspace).toHaveBeenCalledWith(task.repoUrl, task.branchName);
        
        expect(mockMessagesCreate).toHaveBeenCalledTimes(2); // Plan + Execute
        
        const toolsModule = require('../src/tools');
        expect(toolsModule.runPolyglotValidation).toHaveBeenCalledWith('/tmp/test');
        
        expect(mockGit.push).toHaveBeenCalledWith('origin', task.branchName);
        expect(mockCleanup).toHaveBeenCalled();
        expect(mockLangfuseFlush).toHaveBeenCalled();
    });

    it('should commit with WIP if validation fails', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
        });

        const task = {
            ticketId: '1',
            title: 'Test Task',
            description: 'Do something',
            repoUrl: 'http://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining('wip:'));
        expect(mockGit.push).toHaveBeenCalled();
    });

    it('should handle errors and update trace', async () => {
        const workspaceModule = require('../src/workspace');
        const error = new Error('Workspace failed');
        (workspaceModule.setupWorkspace as jest.Mock).mockRejectedValue(error);

        const task = {
            ticketId: '1',
            title: 'Test Task',
        };

        await expect(runAgent(task)).rejects.toThrow('Workspace failed');

        expect(mockTraceUpdate).toHaveBeenCalledWith({ 
            metadata: { 
                level: "ERROR", 
                error: "Workspace failed" 
            } 
        });
        expect(mockLangfuseFlush).toHaveBeenCalled();
    });

    it('should load repo skills if present', async () => {
        // Mock fs to simulate existing skills
        const fsModule = require('fs/promises');
        fsModule.access.mockResolvedValue(undefined);
        fsModule.readdir.mockResolvedValue(['react.md', 'ignored.txt']);
        fsModule.readFile.mockImplementation((path: string) => {
            if (path.endsWith('react.md')) return Promise.resolve('Always use functional components.');
            return Promise.resolve('');
        });

        const task = {
            ticketId: '1',
            title: 'Test Task',
            description: 'Do something',
            repoUrl: 'http://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        // Check if the system prompt (first argument to create) contains the skill
        const callArgs = mockMessagesCreate.mock.calls[0][0];
        expect(callArgs.system).toContain('--- REPO SKILL: REACT.MD ---');
        expect(callArgs.system).toContain('Always use functional components.');
    });
});