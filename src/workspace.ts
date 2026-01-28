import simpleGit from 'simple-git';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';

const WORKSPACE_ROOT = '/tmp/ralph-workspaces';
if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

export function parseRepoUrl(repoUrl: string) {
    // Expected format: https://github.com/owner/repo or https://github.com/owner/repo.git
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^.]+)(\.git)?/);
    if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    return { owner: match[1], repo: match[2] };
}

export async function setupWorkspace(repoUrl: string, branchName: string) {
    const id = uuidv4();
    const workDir = path.join(WORKSPACE_ROOT, id);
    const token = process.env.GITHUB_TOKEN;
    const authUrl = repoUrl.replace('https://', `https://oauth2:${token}@`);

    await simpleGit().clone(authUrl, workDir);
    const git = simpleGit(workDir);
    await git.addConfig('user.name', 'Ralph Bot');
    await git.addConfig('user.email', 'ralph@duvo.ai');
    
    // Improved branch handling:
    // 1. Try to checkout existing branch (local or remote)
    // 2. If it fails, create a new local branch
    try { 
        await git.checkout(branchName); 
    } catch { 
        await git.checkoutLocalBranch(branchName); 
    }

    return { workDir, git, cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }) };
}
