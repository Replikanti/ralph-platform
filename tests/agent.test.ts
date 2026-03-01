import { mock, jest, describe, it, expect, beforeEach } from 'bun:test';

mock.module('../src/infra/account-pool', () => ({
    accountPool: {
        getCredentialsDir: mock().mockResolvedValue('/fake-accounts/account-0'),
        markRateLimited: mock().mockResolvedValue(undefined),
        seedCredentials: mock().mockResolvedValue(undefined),
        hasAvailableAccount: mock().mockResolvedValue(true),
    },
    initAccountPool: mock(),
}));
mock.module('../src/agent/workspace', () => ({
    setupWorkspace: mock(),
    parseRepoUrl: mock(),
}));
mock.module('../src/agent/tools', () => ({
    runPolyglotValidation: mock(),
    detectProjectLanguages: mock(),
}));
mock.module('../src/security/redactor', () => ({
    redactText: mock().mockImplementation((text: string) => Promise.resolve(text)),
}));
mock.module('node:fs/promises', () => ({
    default: {
        access: mock().mockRejectedValue(new Error('No skills')),
        readdir: mock(),
        readFile: mock(),
        mkdir: mock().mockResolvedValue(undefined),
        writeFile: mock().mockResolvedValue(undefined),
        stat: mock().mockResolvedValue({ mtimeMs: Date.now() }),
        cp: mock().mockResolvedValue(undefined),
    },
    access: mock().mockRejectedValue(new Error('No skills')),
    readdir: mock(),
    readFile: mock(),
    mkdir: mock().mockResolvedValue(undefined),
    writeFile: mock().mockResolvedValue(undefined),
    stat: mock().mockResolvedValue({ mtimeMs: Date.now() }),
    cp: mock().mockResolvedValue(undefined),
}));

// BAML mock — replaces plan and summarize phases (no Claude CLI spawn needed)
const mockPlanTask = mock();
const mockSummarizeFailure = mock();

mock.module('../src/infra/baml', () => ({
    b: { PlanTask: mockPlanTask, SummarizeFailure: mockSummarizeFailure },
}));

// spawn mock remains for execute phase (runClaude called directly)
const mockSpawnOn = mock();
const mockStdoutOn = mock();
const mockStderrOn = mock();
const mockSpawn = mock().mockImplementation(() => ({
    stdout: { on: mockStdoutOn },
    stderr: { on: mockStderrOn },
    stdin: { end: mock() },
    on: mockSpawnOn,
    pid: 12345,
}));
const mockExec = mock();

mock.module('node:child_process', () => ({
    spawn: mockSpawn,
    exec: mockExec,
    execSync: mock(),
}));

const mockPullsCreate = mock().mockResolvedValue({ data: { html_url: 'https://github.com/org/repo/pull/1' } });
const mockPullsList = mock().mockResolvedValue({ data: [] });

mock.module('@octokit/rest', () => ({
    Octokit: mock().mockImplementation(() => ({
        rest: {
            pulls: {
                create: mockPullsCreate,
                list: mockPullsList,
            }
        }
    }))
}));

process.env.LINEAR_API_KEY = 'test-key';
process.env.PLAN_REVIEW_ENABLED = 'false';

import { runAgent } from '../src/agent/agent';
import { setupWorkspace, parseRepoUrl } from '../src/agent/workspace';
import { runPolyglotValidation, detectProjectLanguages } from '../src/agent/tools';
import * as fsPromises from 'node:fs/promises';

describe('runAgent', () => {
    let mockGit: any;
    let mockCleanup: any;

    beforeEach(() => {
        jest.clearAllMocks();

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

        (setupWorkspace as any).mockResolvedValue({
            workDir: '/mock/workspace/repo',
            rootDir: '/mock/workspace',
            git: mockGit,
            cleanup: mockCleanup,
        });
        (parseRepoUrl as any).mockReturnValue({
            owner: 'owner',
            repo: 'repo',
        });

        (runPolyglotValidation as any).mockResolvedValue({
            success: true,
            output: 'Validation Passed',
            languages: [],
        });
        (detectProjectLanguages as any).mockResolvedValue(['typescript']);

        // BAML defaults: plan returns structured plan, summarize returns summary
        mockPlanTask.mockResolvedValue({ plan: 'Do X' });
        mockSummarizeFailure.mockResolvedValue({ summary: 'Task failed due to type errors.' });

        // spawn mock for execute phase (runClaude)
        mockSpawnOn.mockImplementation((event: string, cb: any) => {
            if (event === 'close') cb(0);
        });
        mockStdoutOn.mockImplementation((event: string, cb: any) => {
            if (event === 'data') cb(Buffer.from('Implementation done'));
        });

        mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
            const callback = typeof opts === 'function' ? opts : cb;
            if (callback) callback(null, { stdout: '', stderr: '' });
            return Promise.resolve({ stdout: '', stderr: '' });
        });
    });

    it('uses BAML for planning and spawns Claude CLI for execution', async () => {
        (fsPromises.readdir as any).mockResolvedValue([{ name: 'security-audit', isDirectory: () => true }]);
        delete process.env.CLAUDE_BIN_PATH;

        mockPlanTask.mockResolvedValue({ plan: 'Do X' });

        const task = { ticketId: '123', title: 'Test', description: 'Desc', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        const result = await runAgent(task);

        expect(mockPlanTask).toHaveBeenCalledWith('Test', 'Desc', expect.any(String), expect.any(Array));
        expect(mockSpawn).toHaveBeenCalled();
        expect(mockPullsCreate).toHaveBeenCalled();
        expect(result).toMatchObject({ status: 'executed', prUrl: expect.stringContaining('github.com') });
    });

    it('retries on validation failure and returns executed result on eventual success', async () => {
        (runPolyglotValidation as any)
            .mockResolvedValueOnce({ success: false, output: 'Linter error', languages: [] })
            .mockResolvedValueOnce({ success: true, output: 'Fixed', languages: [] });

        const result = await runAgent({ ticketId: 'retry', title: 'Retry Task', repoUrl: 'https://github.com/owner/repo', branchName: 'b' });

        // plan called twice (iter 1 + iter 2), execute called twice via spawn
        expect(mockPlanTask.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(mockSpawn.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(result.status).toBe('executed');
    });

    it('returns validation-failed result after exhausting all retries', async () => {
        (runPolyglotValidation as any).mockResolvedValue({
            success: false,
            output: 'Validation Failed',
            languages: [],
        });

        mockSummarizeFailure.mockResolvedValue({ summary: 'TSC errors prevented compilation.' });

        const task = { ticketId: '1', title: 'Validation Fail', repoUrl: 'https://github.com/owner/repo', branchName: 'b' };
        const result = await runAgent(task);

        expect(result.status).toBe('validation-failed');
        expect(mockSummarizeFailure).toHaveBeenCalled();
        expect(mockGit.commit).not.toHaveBeenCalledWith(expect.stringContaining('wip:'));
        expect(mockPullsCreate).not.toHaveBeenCalled();
    });

    it('returns no-changes result when git has no staged files', async () => {
        mockGit.status.mockResolvedValue({ staged: [] });

        const result = await runAgent({ ticketId: 'no-change', title: 'No Change', repoUrl: 'https://github.com/owner/repo', branchName: 'b' });

        expect(result.status).toBe('no-changes');
        expect(mockPullsCreate).not.toHaveBeenCalled();
    });

    it('returns plan-generated result in plan-only mode', async () => {
        process.env.PLAN_REVIEW_ENABLED = 'true';

        mockPlanTask.mockResolvedValue({ plan: 'Step 1: do X\nStep 2: write tests' });

        const task = { ticketId: 'plan-1', title: 'Plan Task', repoUrl: 'https://github.com/owner/repo', branchName: 'b', mode: 'plan-only' as const };
        const result = await runAgent(task);

        expect(result).toMatchObject({ status: 'plan-generated', plan: expect.stringContaining('Step 1') });
        expect(mockPlanTask).toHaveBeenCalledWith('Plan Task', expect.any(String), expect.any(String), expect.any(Array));
        process.env.PLAN_REVIEW_ENABLED = 'false';
    });
});
