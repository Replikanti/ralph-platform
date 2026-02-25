// Mock Ts.ED decorators
jest.mock('@tsed/common', () => ({
    Service: () => (target: any) => target,
}));

jest.mock('@tsed/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock @octokit/rest
const mockPullsCreate = jest.fn();
const mockOctokit = jest.fn().mockImplementation(() => ({
    rest: {
        pulls: {
            create: mockPullsCreate,
        },
    },
}));

jest.mock('@octokit/rest', () => ({
    Octokit: mockOctokit,
}));

// Mock WorkspaceManager
jest.mock('../../src/domain/WorkspaceManager', () => ({
    parseRepoUrl: jest.fn((url: string) => {
        const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
        return { owner: match?.[1] || 'owner', repo: match?.[2] || 'repo' };
    }),
}));

// Mock config/env
let mockGithubToken = 'ghp_test_token';
jest.mock('../../src/config/env', () => ({
    get GITHUB_TOKEN() {
        return mockGithubToken;
    },
}));

import { GitHubService } from '../../src/services/GitHubService';

describe('GitHubService', () => {
    let service: GitHubService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGithubToken = 'ghp_test_token';
        service = new GitHubService();
    });

    describe('createPullRequest', () => {
        it('should create PR successfully', async () => {
            mockPullsCreate.mockResolvedValueOnce({
                data: {
                    html_url: 'https://github.com/test/repo/pull/123',
                },
            });

            const result = await service.createPullRequest(
                'https://github.com/test/repo',
                'ralph/feat-test',
                'feat: Add feature',
                'PR description'
            );

            expect(result).toBe('https://github.com/test/repo/pull/123');
            expect(mockOctokit).toHaveBeenCalledWith({ auth: 'ghp_test_token' });
            expect(mockPullsCreate).toHaveBeenCalledWith({
                owner: 'test',
                repo: 'repo',
                title: 'feat: Add feature',
                body: 'PR description',
                head: 'ralph/feat-test',
                base: 'main',
            });
        });

        it('should parse repo URL correctly', async () => {
            mockPullsCreate.mockResolvedValueOnce({
                data: { html_url: 'https://github.com/org/project/pull/1' },
            });

            await service.createPullRequest(
                'https://github.com/org/project',
                'ralph/fix-bug',
                'fix: Bug',
                'Body'
            );

            expect(mockPullsCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    owner: 'org',
                    repo: 'project',
                })
            );
        });

        it('should handle PR creation errors', async () => {
            mockPullsCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

            const result = await service.createPullRequest(
                'https://github.com/test/repo',
                'ralph/feat-test',
                'Title',
                'Body'
            );

            expect(result).toBeNull();
        });

        it('should log PR creation errors', async () => {
            const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');
            mockPullsCreate.mockRejectedValueOnce(new Error('Network error'));

            await service.createPullRequest(
                'https://github.com/test/repo',
                'branch',
                'Title',
                'Body'
            );

            expect(loggerErrorSpy).toHaveBeenCalledWith('PR creation failed: Network error');
        });
    });

    describe('generatePRDescription', () => {
        let mockGit: any;

        beforeEach(() => {
            mockGit = {
                diffSummary: jest.fn(),
            };
        });

        it('should generate PR description with diff stats', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [
                    { file: 'src/service.ts' },
                    { file: 'src/controller.ts' },
                ],
                insertions: 150,
                deletions: 30,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Add new feature',
                { success: true, output: '✓ All checks passed' }
            );

            expect(result).toContain('## Task Description');
            expect(result).toContain('Add new feature');
            expect(result).toContain('## Changes Summary');
            expect(result).toContain('**Files changed:** 2');
            expect(result).toContain('**Insertions:** +150');
            expect(result).toContain('**Deletions:** -30');
            expect(result).toContain('Ralph Platform');
        });

        it('should count test files', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [
                    { file: 'src/service.ts' },
                    { file: 'tests/service.test.ts' },
                    { file: '__tests__/controller.spec.ts' },
                ],
                insertions: 200,
                deletions: 50,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: '' }
            );

            expect(result).toContain('**Test files:** 2 modified/added');
        });

        it('should parse Biome validation results', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: '✓ Biome checks passed' }
            );

            expect(result).toContain('## Validation');
            expect(result).toContain('✅ Biome');
        });

        it('should parse TSC validation results', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: 'TSC: 0 errors' }
            );

            expect(result).toContain('✅ TSC');
        });

        it('should parse Ruff validation results', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: 'Ruff: pass' }
            );

            expect(result).toContain('✅ Ruff');
        });

        it('should parse Mypy validation results', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: 'Mypy: Success: no issues' }
            );

            expect(result).toContain('✅ Mypy');
        });

        it('should parse Trivy validation results', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: 'Trivy: 0 vulnerabilities found' }
            );

            expect(result).toContain('✅ Trivy');
        });

        it('should show warning for failed validation', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: false, output: 'Biome: 5 errors found' }
            );

            expect(result).toContain('⚠️ Biome');
        });

        it('should handle missing task description', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [],
                insertions: 0,
                deletions: 0,
            });

            const result = await service.generatePRDescription(
                mockGit,
                '',
                { success: true, output: '' }
            );

            expect(result).not.toContain('## Task Description');
            expect(result).toContain('## Changes Summary');
        });

        it('should handle empty validation output', async () => {
            mockGit.diffSummary.mockResolvedValueOnce({
                files: [{ file: 'src/test.ts' }],
                insertions: 10,
                deletions: 5,
            });

            const result = await service.generatePRDescription(
                mockGit,
                'Task',
                { success: true, output: '' }
            );

            expect(result).not.toContain('## Validation');
        });

        it('should handle git diffSummary errors', async () => {
            mockGit.diffSummary.mockRejectedValueOnce(new Error('Git error'));

            const result = await service.generatePRDescription(
                mockGit,
                'Fallback description',
                { success: true, output: '' }
            );

            expect(result).toBe('Fallback description');
        });

        it('should return default message if no description on error', async () => {
            const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');
            mockGit.diffSummary.mockRejectedValueOnce(new Error('Git error'));

            const result = await service.generatePRDescription(
                mockGit,
                '',
                { success: true, output: '' }
            );

            expect(result).toBe('Implementation completed by Ralph');
            expect(loggerWarnSpy).toHaveBeenCalled();
        });
    });
});
