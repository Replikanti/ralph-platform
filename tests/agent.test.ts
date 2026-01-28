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

process.env.LINEAR_API_KEY = 'test-key';

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
const mockStates = jest.fn().mockResolvedValue({ nodes: [{ name: 'In Progress', id: 's1' }, { name: 'Done', id: 's2' }, { name: 'Triage', id: 's3' }] });

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
        };
        mockCleanup = jest.fn();

        // Re-require mocked modules
        const workspaceModule = require('../src/workspace');
        (workspaceModule.setupWorkspace as jest.Mock).mockResolvedValue({
            workDir: '/mock/workspace',
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
        expect(mockIssueUpdate).toHaveBeenCalled();
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

    it('should commit with WIP if validation fails after retries', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
        });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Fail</plan>'));
        });

        const task = { ticketId: '1', title: 'Validation Fail', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        await runAgent(task);
        
        expect(mockGit.commit).toHaveBeenCalledWith(expect.stringContaining('wip:'));
        expect(mockPullsCreate).toHaveBeenCalledWith(expect.objectContaining({
            title: expect.stringContaining('wip:')
        }));
    });
});
