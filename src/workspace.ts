import simpleGit from 'simple-git';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const WORKSPACE_ROOT = '/tmp/ralph-workspaces';
if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

export async function setupWorkspace(repoUrl: string, branchName: string) {
    const id = uuidv4();
    const workDir = path.join(WORKSPACE_ROOT, id);
    const token = process.env.GITHUB_TOKEN;
    const authUrl = repoUrl.replace('https://', `https://oauth2:${token}@`);

    await simpleGit().clone(authUrl, workDir);
    const git = simpleGit(workDir);
    await git.addConfig('user.name', 'Ralph Bot');
    await git.addConfig('user.email', 'ralph@duvo.ai');
    
    try { await git.checkout(branchName); } 
    catch { await git.checkoutLocalBranch(branchName); }

    return { workDir, git, cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }) };
}
