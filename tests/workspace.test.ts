import { mock, jest, describe, it, expect, beforeEach } from 'bun:test';

mock.module('simple-git', () => ({ default: mock() }));
mock.module('node:fs', () => ({
    default: { existsSync: mock(), mkdirSync: mock(), rmSync: mock() },
    existsSync: mock(),
    mkdirSync: mock(),
    rmSync: mock(),
}));
mock.module('node:fs/promises', () => ({
    default: { mkdir: mock().mockResolvedValue(undefined) },
    mkdir: mock().mockResolvedValue(undefined),
}));
mock.module('uuid', () => ({
    v4: () => 'test-uuid',
}));

import { setupWorkspace } from '../src/workspace';
import simpleGit from 'simple-git';
import fs from 'node:fs';

const mockedGit = simpleGit as any;
const mockedFsMkdirSync = fs.mkdirSync as any;
const mockedFsRmSync = fs.rmSync as any;

describe('setupWorkspace', () => {
    let gitInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        gitInstance = {
            clone: jest.fn(),
            addConfig: jest.fn(),
            checkout: jest.fn(),
            checkoutLocalBranch: jest.fn(),
        };
        mockedGit.mockReturnValue(gitInstance);
        (fs.existsSync as any).mockReturnValue(false);
    });

    it('should setup workspace and clone repo', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const branchName = 'feature/test';

        const { workDir, rootDir, cleanup } = await setupWorkspace(repoUrl, branchName);

        expect(workDir).toContain('repo');
        expect(rootDir).not.toContain('repo');

        cleanup();
        expect(mockedFsRmSync).toHaveBeenCalledWith(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });

    it('should create new branch if checkout fails', async () => {
        const repoUrl = 'https://github.com/user/repo';
        const branchName = 'feature/test';

        gitInstance.checkout.mockRejectedValue(new Error('Branch not found'));

        await setupWorkspace(repoUrl, branchName);

        expect(gitInstance.checkoutLocalBranch).toHaveBeenCalledWith(branchName);
    });
});
