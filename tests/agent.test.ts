jest.mock('../src/workspace');
jest.mock('../src/tools');
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
}));

describe('runAgent', () => {
    let mockGit: any;
    let mockCleanup: any;
    let mockMessagesCreate: any;
    let mockTraceSpan: any;
    let mockSpanEnd: any;
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
            workDir: '/mock/workspace',
            git: mockGit,
            cleanup: mockCleanup,
        });

        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: true,
            output: 'Validation Passed',
        });
        // Ensure other tool functions are mocks
        toolsModule.listFiles.mockResolvedValue('file.txt');
        toolsModule.readFile.mockResolvedValue('content');
        toolsModule.writeFile.mockResolvedValue('Wrote to file');
        toolsModule.runCommand.mockResolvedValue('Command output');
        // Ensure agentTools is defined
        toolsModule.agentTools = [];

        // Setup Anthropic Mock
        mockMessagesCreate = jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Generated Plan/Code' }],
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
            repoUrl: 'https://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        // We need to check against the mock function that was actually used
        const workspaceModule = require('../src/workspace');
        expect(workspaceModule.setupWorkspace).toHaveBeenCalledWith(task.repoUrl, task.branchName);
        
        expect(mockMessagesCreate).toHaveBeenCalledTimes(2); // Plan + Execute
        
        const toolsModule = require('../src/tools');
        expect(toolsModule.runPolyglotValidation).toHaveBeenCalledWith('/mock/workspace');
        
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
            repoUrl: 'https://repo',
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
        const fsModule = require('node:fs/promises');
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
            repoUrl: 'https://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        // Check if the system prompt (first argument to create) contains the skill
        const callArgs = mockMessagesCreate.mock.calls[0][0];
        expect(callArgs.system).toContain('--- REPO SKILL: REACT.MD ---');
        expect(callArgs.system).toContain('Always use functional components.');
    });

    it('should execute tools in the loop', async () => {
        const toolsModule = require('../src/tools');
        
        // Mock sequence: 
        // 1. Plan (Opus) -> Text
        // 2. Execute (Sonnet) Iteration 1 -> Tool Use
        // 3. Execute (Sonnet) Iteration 2 -> Text (Done)
        mockMessagesCreate
            .mockResolvedValueOnce({ 
                content: [{ type: 'text', text: 'Plan: Create file' }] // Opus
            })
            .mockResolvedValueOnce({
                content: [{ 
                    type: 'tool_use', 
                    id: 'call_1', 
                    name: 'write_file', 
                    input: { path: 'test.txt', content: 'hello' } 
                }] // Sonnet Iter 1
            })
            .mockResolvedValueOnce({
                content: [{ type: 'text', text: 'Done' }] // Sonnet Iter 2
            });

        const task = {
            ticketId: '1',
            title: 'Tool Task',
            description: 'Write a file',
            repoUrl: 'https://repo',
            branchName: 'branch',
        };

        await runAgent(task);

        // Verify tool execution
        expect(toolsModule.writeFile).toHaveBeenCalledWith('/mock/workspace', 'test.txt', 'hello');
        
        // Verify loop continuation (called Anthropic 3 times: Plan, Iter 1, Iter 2)
        expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    });

    it('should handle tool execution errors gracefully', async () => {
        const toolsModule = require('../src/tools');
        toolsModule.writeFile.mockRejectedValue(new Error('Write failed'));

        mockMessagesCreate
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Plan' }] })
            .mockResolvedValueOnce({
                content: [{ 
                    type: 'tool_use', 
                    id: 'call_error', 
                    name: 'write_file', 
                    input: { path: 'fail.txt', content: '' } 
                }]
            })
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done' }] });

        await runAgent({ ticketId: 'error-test', title: 'Error Task', repoUrl: 'https://repo', branchName: 'b' });

        // Verify the error result was sent back to the agent
        const lastCallArgs = mockMessagesCreate.mock.calls[2][0];
        const toolResult = lastCallArgs.messages.find((m: any) => m.role === 'user' && Array.isArray(m.content)).content[0];
        expect(toolResult.content).toContain('Error executing tool: Write failed');
    });

    it('should report unknown tools to the agent', async () => {
        mockMessagesCreate
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Plan' }] })
            .mockResolvedValueOnce({
                content: [{
                    type: 'tool_use',
                    id: 'call_unknown',
                    name: 'mystery_tool',
                    input: {}
                }]
            })
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done' }] });

        await runAgent({ ticketId: 'unknown-test', title: 'Unknown Task', repoUrl: 'https://repo', branchName: 'b' });

        const lastCallArgs = mockMessagesCreate.mock.calls[2][0];
        const toolResult = lastCallArgs.messages.find((m: any) => m.role === 'user' && Array.isArray(m.content)).content[0];
        expect(toolResult.content).toContain('Error: Unknown tool mystery_tool');
    });

    describe('Loop Telemetry', () => {
        it('should create per-iteration spans with tool call metadata', async () => {
            const toolsModule = require('../src/tools');

            mockMessagesCreate
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Plan' }] })
                .mockResolvedValueOnce({
                    content: [{
                        type: 'tool_use',
                        id: 'call_1',
                        name: 'read_file',
                        input: { path: 'src/index.ts' }
                    }]
                })
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done' }] });

            await runAgent({ ticketId: 'tel-1', title: 'Telemetry Test', repoUrl: 'https://repo', branchName: 'b' });

            // Verify iteration spans were created
            const spanCalls = mockTraceSpan.mock.calls;
            const iterationSpans = spanCalls.filter((call: any) => call[0]?.name === 'LoopIteration');

            expect(iterationSpans.length).toBeGreaterThan(0);
            expect(iterationSpans[0][0].metadata.iteration).toBe(1);
        });

        it('should include finish_reason in coding span metadata', async () => {
            mockMessagesCreate
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Plan' }] })
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done immediately' }] });

            await runAgent({ ticketId: 'tel-2', title: 'Quick Task', repoUrl: 'https://repo', branchName: 'b' });

            // Find the Coding span end call
            const spanEndCalls = mockSpanEnd.mock.calls;
            const codingSpanEnd = spanEndCalls.find((call: any) =>
                call[0]?.metadata?.finish_reason !== undefined
            );

            expect(codingSpanEnd).toBeDefined();
            expect(codingSpanEnd[0].metadata.finish_reason).toBe('NO_TOOL_USE');
        });

        it('should track repeated file reads in telemetry', async () => {
            const toolsModule = require('../src/tools');

            // Simulate reading same file multiple times
            mockMessagesCreate
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Plan' }] })
                .mockResolvedValueOnce({
                    content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'package.json' } }]
                })
                .mockResolvedValueOnce({
                    content: [{ type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'package.json' } }]
                })
                .mockResolvedValueOnce({
                    content: [{ type: 'tool_use', id: 'c3', name: 'read_file', input: { path: 'package.json' } }]
                })
                .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Done' }] });

            await runAgent({ ticketId: 'tel-3', title: 'Repeated Reads', repoUrl: 'https://repo', branchName: 'b' });

            // Verify repeated reads are tracked (check coding span metadata)
            const spanEndCalls = mockSpanEnd.mock.calls;
            const codingSpanEnd = spanEndCalls.find((call: any) =>
                call[0]?.metadata?.repeated_reads_count !== undefined
            );

            expect(codingSpanEnd).toBeDefined();
            expect(codingSpanEnd[0].metadata.repeated_reads_count).toBeGreaterThan(0);
        });
    });
});