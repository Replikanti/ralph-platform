jest.mock('../src/workspace');
jest.mock('../src/tools');

// Mock @redactpii/node to avoid ESM issues in Jest
jest.mock('@redactpii/node', () => ({
    AsyncRedactor: jest.fn().mockImplementation(() => ({
        redact: jest.fn().mockImplementation((text) => Promise.resolve(text))
    })),
    CustomRedactor: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('node:fs/promises', () => ({
    access: jest.fn().mockRejectedValue(new Error('No skills')),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    cp: jest.fn().mockResolvedValue(undefined),
}));

jest.setTimeout(30000);

process.env.LINEAR_API_KEY = 'test-key';
process.env.PLAN_REVIEW_ENABLED = 'false'; // Run in full mode for most tests

const mockSpawnOn = jest.fn();
const mockStdoutOn = jest.fn();
const mockStderrOn = jest.fn();

const mockSpawn = jest.fn().mockImplementation(() => ({
    stdout: { on: mockStdoutOn },
    stderr: { on: mockStderrOn },
    stdin: { end: jest.fn() },
    on: mockSpawnOn,
    pid: 12345,
}));

const mockExec = jest.fn();

jest.mock('node:child_process', () => ({
    spawn: mockSpawn,
    exec: mockExec,
}));

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

// Mock Octokit — PR creation still lives in agent
const mockPullsCreate = jest.fn().mockResolvedValue({ data: { html_url: 'https://github.com/org/repo/pull/1' } });
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
        jest.clearAllMocks();
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
                deletions: 25,
            }),
        };
        mockCleanup = jest.fn();

        const workspaceModule = require('../src/workspace');
        (workspaceModule.setupWorkspace as jest.Mock).mockResolvedValue({
            workDir: '/mock/workspace/repo',
            rootDir: '/mock/workspace',
            git: mockGit,
            cleanup: mockCleanup,
        });
        (workspaceModule.parseRepoUrl as jest.Mock).mockReturnValue({
            owner: 'owner',
            repo: 'repo',
        });

        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: true,
            output: 'Validation Passed',
            languages: [],
            toolResults: {},
            totalErrors: 0,
            relevantErrors: 0,
        });
        (toolsModule.detectProjectLanguages as jest.Mock).mockResolvedValue(['typescript']);

        mockSpawnOn.mockImplementation((event, cb) => {
            if (event === 'close') cb(0);
        });
        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('Default Output'));
        });

        mockExec.mockImplementation((cmd, opts, cb) => {
            const callback = typeof opts === 'function' ? opts : cb;
            if (callback) callback(null, { stdout: '', stderr: '' });
            return Promise.resolve({ stdout: '', stderr: '' });
        });

        mockSpanEnd = jest.fn();
        mockTraceSpan = jest.fn().mockReturnValue({ end: mockSpanEnd });
        mockTraceUpdate = jest.fn();
        mockLangfuseFlush = jest.fn();

        jest.doMock('langfuse', () => ({
            Langfuse: jest.fn().mockImplementation(() => ({
                trace: jest.fn().mockReturnValue({
                    span: mockTraceSpan,
                    update: mockTraceUpdate,
                    shutdownAsync: jest.fn(),
                }),
                flushAsync: mockLangfuseFlush,
            }))
        }));

        const agentModule = require('../src/agent');
        runAgent = agentModule.runAgent;
    });

    it('spawns Claude CLI and returns executed result on success', async () => {
        const fsModule = require('node:fs/promises');
        fsModule.readdir.mockResolvedValue([{ name: 'security-audit', isDirectory: () => true }]);
        fsModule.readFile.mockResolvedValue('CLAUDE.md content');
        delete process.env.CLAUDE_BIN_PATH;

        mockStdoutOn
            .mockImplementationOnce((event, cb) => { if (event === 'data') cb(Buffer.from('<plan>Do X</plan>')); })
            .mockImplementationOnce((event, cb) => { if (event === 'data') cb(Buffer.from('Implementation done')); });

        const task = { ticketId: '123', title: 'Test', description: 'Desc', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        const result = await runAgent(task);

        expect(mockSpawn).toHaveBeenCalled();
        expect(mockPullsCreate).toHaveBeenCalled();
        expect(result).toMatchObject({ status: 'executed', prUrl: expect.stringContaining('github.com') });
    });

    it('retries on validation failure and returns executed result on eventual success', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock)
            .mockResolvedValueOnce({ success: false, output: 'Linter error', languages: [], toolResults: {}, totalErrors: 1, relevantErrors: 1 })
            .mockResolvedValueOnce({ success: true, output: 'Fixed', languages: [], toolResults: {}, totalErrors: 0, relevantErrors: 0 });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Try</plan>'));
        });

        const result = await runAgent({ ticketId: 'retry', title: 'Retry Task', repoUrl: 'https://github.com/owner/repo', branchName: 'b' });

        expect(mockSpawn.mock.calls.length).toBeGreaterThanOrEqual(4);
        expect(result.status).toBe('executed');
    });

    it('returns validation-failed result after exhausting all retries', async () => {
        const toolsModule = require('../src/tools');
        (toolsModule.runPolyglotValidation as jest.Mock).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
            languages: [],
            toolResults: {},
            totalErrors: 5,
            relevantErrors: 5,
        });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('Ralph tried to fix X but TSC failed.'));
        });

        const task = { ticketId: '1', title: 'Validation Fail', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        const result = await runAgent(task);

        expect(result.status).toBe('validation-failed');
        expect(mockGit.commit).not.toHaveBeenCalledWith(expect.stringContaining('wip:'));
        expect(mockPullsCreate).not.toHaveBeenCalled();
    });

    it('returns no-changes result when git has no staged files', async () => {
        mockGit.status.mockResolvedValue({ staged: [] });

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Do X</plan>'));
        });

        const result = await runAgent({ ticketId: 'no-change', title: 'No Change', repoUrl: 'https://github.com/owner/repo', branchName: 'b' });

        expect(result.status).toBe('no-changes');
        expect(mockPullsCreate).not.toHaveBeenCalled();
    });

    it('returns plan-generated result in plan-only mode', async () => {
        process.env.PLAN_REVIEW_ENABLED = 'true';
        const agentModule = require('../src/agent');
        runAgent = agentModule.runAgent;

        mockStdoutOn.mockImplementation((event, cb) => {
            if (event === 'data') cb(Buffer.from('<plan>Step 1: do X</plan>'));
        });

        const task = { ticketId: 'plan-1', title: 'Plan Task', repoUrl: 'https://github.com/owner/repo', branchName: 'b', mode: 'plan-only' as const };
        const result = await runAgent(task);

        expect(result).toMatchObject({ status: 'plan-generated', plan: expect.stringContaining('Step 1') });
        process.env.PLAN_REVIEW_ENABLED = 'false';
    });
});
