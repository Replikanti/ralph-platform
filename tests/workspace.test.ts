import { setupWorkspace } from '../src/workspace';
import simpleGit from 'simple-git';
import fs from 'node:fs';

jest.mock('simple-git');
jest.mock('node:fs');
jest.mock('node:fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('uuid', () => ({
    v4: () => 'test-uuid'
}));

const mockedGit = simpleGit as unknown as jest.Mock;
const mockedFsMkdirSync = fs.mkdirSync as jest.Mock;
const mockedFsRmSync = fs.rmSync as jest.Mock;

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
        (fs.existsSync as jest.Mock).mockReturnValue(false);
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
