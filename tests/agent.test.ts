jest.mock('../src/workspace');
jest.mock('../src/tools');
jest.mock('../src/plan-store');

// Mock RalphLinearClient
const mockUpdateIssueState = jest.fn().mockResolvedValue(true);
const mockPostComment = jest.fn().mockResolvedValue(undefined);
const mockGetIssueState = jest.fn().mockResolvedValue('In Progress');
const mockIsEnabled = jest.fn().mockReturnValue(true);

jest.mock('../src/linear-client', () => ({
    LinearClient: jest.fn().mockImplementation(() => ({
        updateIssueState: mockUpdateIssueState,
        postComment: mockPostComment,
        getIssueState: mockGetIssueState,
        isEnabled: mockIsEnabled
    }))
}));

jest.mock('ioredis');
jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    cp: jest.fn().mockResolvedValue(undefined),
}));

// Set a longer timeout for agent tests involving CLI mocks
jest.setTimeout(30000);

process.env.LINEAR_API_KEY = 'test-key';
process.env.PLAN_REVIEW_ENABLED = 'false'; // Disable plan review for most tests

// Mock child_process for spawn and exec
const mockSpawnOn = jest.fn();
const mockStdoutOn = jest.fn();
const mockStderrOn = jest.fn();

const mockSpawn = jest.fn().mockImplementation(() => ({
    stdout: { on: mockStdoutOn },
    stderr: { on: mockStderrOn },
    stdin: { end: jest.fn() }, // Added mock for stdin.end
    on: mockSpawnOn,
    pid: 12345 // Added PID for debug check
}));

const mockExec = jest.fn();

jest.mock('node:child_process', () => ({
    spawn: mockSpawn,
    exec: mockExec
}));

// Mock util.promisify
jest.mock('node:util', () => {
    const originalUtil = jest.requireActual('node:util');
    return {
        ...originalUtil,
        promisify: (fn: any) => {
            if (fn === mockExec) return mockExec;
            return originalUtil.promisify(fn);
        }
    };
});

// Mock Linear
const mockIssueUpdate = jest.fn();
const mockCommentCreate = jest.fn();
const mockStates = jest.fn().mockResolvedValue({ nodes: [{ name: 'In Progress', id: 's1' }, { name: 'In Review', id: 's2' }, { name: 'Todo', id: 's3' }, { name: 'Done', id: 's4' }, { name: 'Triage', id: 's5' }] });

jest.mock('@linear/sdk', () => ({
    LinearClient: jest.fn().mockImplementation(() => ({
        issue: jest.fn().mockResolvedValue({
            team: Promise.resolve({
                states: mockStates
            })
        }),
        updateIssue: mockIssueUpdate,
        createComment: mockCommentCreate
    }))
}));

// Mock Octokit
const mockPullsCreate = jest.fn().mockResolvedValue({ data: { html_url: 'https://github.com/pr/1' } });
const mockPullsList = jest.fn().mockResolvedValue({ data: [] });

jest.mock('@octokit/rest', () => ({
    Octokit: jest.fn().mockImplementation(() => ({
        rest: {
            pulls: {
                create: mockPullsCreate,
                list: mockPullsList,
            }
        }
    }))
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
            status: jest.fn().mockResolvedValue({ staged: ['README.md'] }),
            diffSummary: jest.fn().mockResolvedValue({
                files: [
                    { file: 'src/agent.ts', insertions: 50, deletions: 20 },
                    { file: 'tests/agent.test.ts', insertions: 30, deletions: 5 }
                ],
                insertions: 80,
                deletions: 25
            }),
        };
        mockCleanup = jest.fn();

        // Re-require mocked modules
        const workspaceModule = require('../src/workspace');
        (workspaceModule.setupWorkspace as jest.Mock).mockResolvedValue({
            workDir: '/mock/workspace/repo',
            rootDir: '/mock/workspace',
            git: mockGit,
            cleanup: mockCleanup,
        });
        (workspaceModule.parseRepoUrl as jest.Mock).mockReturnValue({
            owner: 'owner',
            repo: 'repo'
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
            if (callback) callback(null, { stdout: '', stderr: '' });
            return Promise.resolve({ stdout: '', stderr: '' });
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
        const fsModule = require('node:fs/promises');
        fsModule.readdir.mockResolvedValue([{ name: 'security-audit', isDirectory: () => true }]);
        fsModule.readFile.mockResolvedValue('CLAUDE.md content');

        // Ensure we test the default path if env is not set
        delete process.env.CLAUDE_BIN_PATH;

        mockStdoutOn
            .mockImplementationOnce((event, cb) => { if (event === 'data') cb(Buffer.from('<plan>Do X</plan>')); })
            .mockImplementationOnce((event, cb) => { if (event === 'data') cb(Buffer.from('Implementation done')); });

        const task = { ticketId: '123', title: 'Test', description: 'Desc', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        await runAgent(task);

        expect(mockSpawn).toHaveBeenCalled();
        expect(mockPullsCreate).toHaveBeenCalled();
        expect(mockUpdateIssueState).toHaveBeenCalled();
    });

    it('should retry if validation fails and eventually succeed', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock)
            .mockResolvedValueOnce({ success: false, output: 'Linter error' })
            .mockResolvedValueOnce({ success: true, output: 'Fixed' });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Try</plan>'));
        });

        await runAgent({ ticketId: 'retry', title: 'Retry Task', repoUrl: 'https://github.com/owner/repo', branchName: 'b' });
        expect(mockSpawn.mock.calls.length).toBeGreaterThanOrEqual(4);
        expect(mockPullsCreate).toHaveBeenCalled();
    });

        it('should report failure to Linear and NOT push WIP if validation fails after retries', async () => {
            const toolsModule = require('../src/tools');
            (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
                success: false,
                output: 'Validation Failed',
            });
    
            mockStdoutOn.mockImplementation((event, cb) => {
                if (event === 'data') cb(Buffer.from('Ralph tried to fix X but TSC failed. A human should take over.'));
            });
    
            const task = { ticketId: '1', title: 'Validation Fail', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
            await runAgent(task);
            
            // Should NOT have committed or created a PR
            expect(mockGit.commit).not.toHaveBeenCalledWith(expect.stringContaining('wip:'));
            expect(mockPullsCreate).not.toHaveBeenCalledWith(expect.objectContaining({
                title: expect.stringContaining('wip:')
            }));

            // Verify ticket moved back to backlog state
            expect(mockUpdateIssueState).toHaveBeenCalledWith('1', 'Todo');
            // Should have added an explanation comment
            expect(mockPostComment).toHaveBeenCalledWith('1', expect.stringContaining('Ralph tried to fix X'));
        });
        it('should update Linear status to "In Review" when PR is created successfully', async () => {
        const fsModule = require('node:fs/promises');
        fsModule.readdir.mockResolvedValue([]);
        fsModule.readFile.mockResolvedValue('CLAUDE.md content');

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Do X</plan>'));
        });

        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: true,
            output: 'Validation Passed',
        });

        mockIssueUpdate.mockClear();

        const task = { ticketId: 'pr-test', title: 'Test PR Creation', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        await runAgent(task);

        // Verify that status was updated to "In Review"
        expect(mockUpdateIssueState).toHaveBeenCalledWith('pr-test', 'In Review');
        expect(mockPullsCreate).toHaveBeenCalled();
    });


});
