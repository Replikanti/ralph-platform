import { Langfuse } from "langfuse";
import { setupWorkspace, parseRepoUrl } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { LinearClient } from "@linear/sdk";

const langfuse = new Langfuse();

// --- TYPES ---

export interface Task {
    ticketId: string;
    title: string;
    description?: string;
    repoUrl: string;
    branchName: string;
    jobId: string;
    attempt: number;
    maxAttempts: number;
}

interface IterationContext {
    workDir: string;
    homeDir: string;
    task: Task;
    availableSkills: string;
    git: any;
    trace: any;
}

// --- HELPERS ---

async function findTargetState(team: any, statusName: string) {
    const states = await team.states();
    const name = statusName.toLowerCase();
    
    let state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === name);
    if (state) return state;

    const synonymMap: Record<string, string[]> = {
        'todo': ['triage', 'backlog', 'todo', 'unstarted', 'ready'],
        'in review': ['in review', 'under review', 'peer review', 'review', 'pr']
    };

    const synonyms = synonymMap[name];
    if (synonyms) {
        for (const syn of synonyms) {
            state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === syn);
            if (state) return state;
        }
    }

    return null;
}

export async function updateLinearIssue(issueId: string, statusName: string, comment?: string) {
    if (!process.env.LINEAR_API_KEY) return;
    
    try {
        const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
        const issue = await linear.issue(issueId);
        const team = await issue.team;
        if (!team) return;

        const targetState = await findTargetState(team, statusName);

        if (targetState) {
            const currentState = await issue.state;
            if (currentState?.id !== targetState.id) {
                console.log("Updating Linear status to: " + statusName);
                await linear.updateIssue(issueId, { stateId: targetState.id });
            }
        }

        if (comment) {
            console.log("Adding comment to Linear issue " + issueId);
            await linear.createComment({ issueId, body: comment });
        }
    } catch (e: any) {
        console.error("Linear update failed: " + e.message);
    }
}

async function summarizeFailurePhase(task: Task, homeDir: string, errors: string): Promise<string> {
    const prompt = "You are the Post-Mortem Analyst. Ralph failed a task. " +
        "TASK: " + task.title + " ERRORS: " + errors.substring(0, 2000) + 
        " Explain why it failed in 2 sentences.";
    try {
        // Use Haiku 4.5 for summary to save money
        const { stdout } = await runClaude([
            '-p', prompt, 
            '--model', 'claude-haiku-4-5-20251001', 
            '--tools', '',
            '--max-budget-usd', '0.10'
        ], process.cwd(), homeDir);
        return stdout.trim();
    } catch {
        return "Task failed due to persistent validation errors.";
    }
}

async function createPullRequest(repoUrl: string, branchName: string, title: string, body: string): Promise<string | null> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    try {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        
        const response = await octokit.rest.pulls.create({
            owner,
            repo,
            title,
            body,
            head: branchName,
            base: 'main', 
        });
        return response.data.html_url;
    } catch (e: any) {
        console.error("PR failed: " + e.message);
        return null;
    }
}

function runClaude(args: string[], cwd: string, homeDir: string, timeoutMs: number = 300000): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const CLAUDE_PATH = process.env.CLAUDE_BIN_PATH || '/usr/local/bin/claude';
        
        console.log("🚀 Spawning: " + CLAUDE_PATH + " in " + cwd);

        const child = spawn(CLAUDE_PATH, args, { 
            cwd,
            env: { 
                ...process.env, 
                HOME: homeDir,
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                CI: 'true',
                DEBUG: 'true',
                TERM: 'dumb',
                CLAUDE_CODE_ANALYTICS: 'false'
            }
        });

        if (child.stdin) child.stdin.end();

        if (!child.pid) {
            reject(new Error("Failed to spawn Claude CLI"));
            return;
        }
        
        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
                const str = data.toString();
                stdout += str;
                process.stdout.write(str); 
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                const str = data.toString();
                stderr += str;
                process.stderr.write(str);
            });
        }

        const timeout = setTimeout(() => {
            console.error("🛑 Timeout after " + timeoutMs + "ms. Killing PID " + child.pid);
            child.kill('SIGKILL');
            reject(new Error("Claude CLI timed out after " + timeoutMs + "ms. Output: " + stdout.substring(stdout.length - 200)));
        }, timeoutMs);

        child.on('close', (code: number) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const combined = (stderr + " " + stdout).trim();
                reject(new Error("Claude CLI exited with code " + code + ". Output: " + combined.substring(0, 500)));
            }
        });

        child.on('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

const SECURITY_GUARDRAILS = "SECURITY RULES: 1. NO SECRETS. 2. SANDBOX: Only modify files inside the workspace.";

async function listAvailableSkills(workDir: string): Promise<string> {
    const skillsDir = path.join(workDir, '.claude', 'skills');
    try {
        const dirs = await fsPromises.readdir(skillsDir, { withFileTypes: true });
        return dirs
            .filter((d: fs.Dirent) => d.isDirectory())
            .map((d: fs.Dirent) => "- /" + d.name)
            .join('\n');
    } catch { return "No native skills available."; }
}

async function withTrace<T>(name: string, metadata: Record<string, any>, fn: (span: any) => Promise<T>) {
    const trace = langfuse.trace({ name, metadata });
    try { return await fn(trace); } 
    catch (e: any) { 
        trace.update({ metadata: { error: e.message } });
        throw e; 
    } 
    finally { await langfuse.flushAsync(); }
}

async function planPhase(workDir: string, homeDir: string, task: any, availableSkills: string, previousErrors?: string) {
    let guide = "";
    try { guide = await fsPromises.readFile(path.join(workDir, 'CLAUDE.md'), 'utf-8'); } catch { guide = "None."; }

    const prompt = "You are the Architect. Create a plan for the Executor.\n" +
        "GUIDE: " + guide + "\nTASK: " + task.title + "\nDESC: " + task.description + "\n" +
        "SKILLS: " + availableSkills + "\n" + (previousErrors ? "PREV ERRORS: " + previousErrors : "") + "\n" +
        "GOAL: Step-by-step plan using native skills. Output inside <plan> tags. BE CONCISE.";

    // Switch to Sonnet 4.5 and add budget limit
    const { stdout } = await runClaude([
        '-p', prompt, 
        '--model', 'claude-sonnet-4-5-20250929', 
        '--tools', '', 
        '--max-budget-usd', '0.50',
        '--no-session-persistence'
    ], workDir, homeDir);
    const match = /<plan>([\s\S]*?)<\/plan>/.exec(stdout);
    return match ? match[1].trim() : "No plan tags found.";
}

async function executePhase(workDir: string, homeDir: string, plan: string) {
    const prompt = "You are the Executor. Implement this plan strictly: " + plan + "\n" +
        "RULES: No secrets, stay in sandbox, only necessary files, do not commit.";
    return await runClaude([
        '-p', prompt, 
        '--model', 'sonnet', 
        '--tools', 'Bash,Read,Edit,FileSearch,Glob',
        '--dangerously-skip-permissions', 
        '--permission-mode', 'bypassPermissions',
        '--max-budget-usd', '2.00', // Hard limit for one execution attempt
        '--no-session-persistence'
    ], workDir, homeDir, 900000);
}

const CLAUDE_CACHE_ROOT = process.env.CLAUDE_CACHE_PATH || '/app/claude-cache';
if (!fs.existsSync(CLAUDE_CACHE_ROOT)) {
    try { fs.mkdirSync(CLAUDE_CACHE_ROOT, { recursive: true }); } catch (e: any) {
        console.warn("Could not create cache root: " + e.message);
    }
}

async function seedClaudeCache(targetClaudeDir: string) {
    const projectsCache = path.join(CLAUDE_CACHE_ROOT, 'projects');
    if (fs.existsSync(projectsCache)) {
        const targetProjects = path.join(targetClaudeDir, 'projects');
        await fsPromises.mkdir(targetProjects, { recursive: true });
        const { execSync } = await import('node:child_process');
        try {
            execSync("cp -r " + projectsCache + "/* " + targetProjects + "/");
            console.log("Seeded Claude projects cache from global storage");
        } catch (e: any) { console.warn("Seed failed: " + e.message); }
    }
}

async function persistClaudeCache(sourceClaudeDir: string) {
    const projectsSource = path.join(sourceClaudeDir, 'projects');
    if (fs.existsSync(projectsSource)) {
        const targetProjects = path.join(CLAUDE_CACHE_ROOT, 'projects');
        await fsPromises.mkdir(targetProjects, { recursive: true });
        const { execSync } = await import('node:child_process');
        try {
            execSync("cp -r " + projectsSource + "/* " + targetProjects + "/");
            console.log("Persisted Claude projects cache to global storage");
        } catch (e: any) { console.warn("Persistence failed: " + e.message); }
    }
}

async function prepareClaudeSkills(workDir: string, homeDir: string) {

    const targetSkillsDir = path.join(homeDir, '.claude', 'skills');

    const sourceSkillsDir = path.join(workDir, '.claude', 'skills');

    const targetScriptsDir = path.join(homeDir, '.claude', 'scripts');

    const sourceScriptsDir = path.join(workDir, '.claude', 'scripts');



    try {

        if (await fsPromises.stat(sourceSkillsDir).then(() => true).catch(() => false)) {

            await fsPromises.mkdir(targetSkillsDir, { recursive: true });

            await fsPromises.cp(sourceSkillsDir, targetSkillsDir, { recursive: true });

        }

        if (await fsPromises.stat(sourceScriptsDir).then(() => true).catch(() => false)) {

            await fsPromises.mkdir(targetScriptsDir, { recursive: true });

            await fsPromises.cp(sourceScriptsDir, targetScriptsDir, { recursive: true });

        }

        console.log("Loaded skills into isolated Claude environment");

    } catch (e: any) {

        console.warn("Failed to load skills: " + e.message);

    }

}



async function runIteration(iteration: number, ctx: IterationContext, previousErrors: string): Promise<{ success: boolean, output?: string }> {
    console.log("🤖 Iteration " + iteration);

    const planSpan = ctx.trace.span({ name: "Planning-Opus-Iter-" + iteration, metadata: { iteration } });
    const rawPlan = await planPhase(ctx.workDir, ctx.homeDir, ctx.task, ctx.availableSkills, previousErrors);
    const plan = rawPlan.replaceAll('<plan>', '').replaceAll('</plan>', '').trim();
    planSpan.end({ output: plan });

    const execSpan = ctx.trace.span({ name: "Execution-Sonnet-Iter-" + iteration, metadata: { iteration } });
    await executePhase(ctx.workDir, ctx.homeDir, plan);
    execSpan.end();

    const check = await runPolyglotValidation(ctx.workDir);
    if (check.success) {
        console.log("✅ Validation passed!");
        await ctx.git.add('.');
        const status = await ctx.git.status();
        if (status.staged.length > 0) {
            await ctx.git.commit("feat: " + ctx.task.title);
            await ctx.git.push('origin', ctx.task.branchName, ['--force']);
            const prUrl = await createPullRequest(ctx.task.repoUrl, ctx.task.branchName, "feat: " + ctx.task.title, ctx.task.description || '');
            await updateLinearIssue(ctx.task.ticketId, "In Review", "✅ Done. PR: " + prUrl);
        } else {
            console.warn("⚠️ No files changed.");
            await updateLinearIssue(ctx.task.ticketId, "Todo", "⚠️ No changes necessary.");
        }
        return { success: true };
    }
    console.warn("⚠️ Validation failed (Iter " + iteration + "):\n" + check.output);
    return { success: false, output: check.output };
}

async function handleFailureFallback(workDir: string, homeDir: string, task: Task, git: any, previousErrors: string, MAX_RETRIES: number): Promise<void> {
    console.warn("🛑 Task failed after " + MAX_RETRIES + " attempts.");
    const explanation = await summarizeFailurePhase(task, homeDir, previousErrors);
    const failComment = "❌ Failed after " + MAX_RETRIES + " attempts.\n\n" + explanation + "\n\n---\nDetails:\n```\n" + previousErrors.substring(0, 1000) + "...\n```";
    await updateLinearIssue(task.ticketId, "Todo", failComment);
}

export const runAgent = async (task: Task): Promise<void> => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace: any) => {
        const { workDir, rootDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        const homeDir = path.join(rootDir, 'home');
        const targetClaudeDir = path.join(homeDir, '.claude');
        
        try {
            await fsPromises.mkdir(targetClaudeDir, { recursive: true });
            const sourceClaudeDir = path.join(os.homedir(), '.claude');
            try {
                const files = ['.credentials.json', 'settings.json'];
                for (const f of files) {
                    const src = path.join(sourceClaudeDir, f);
                    const dst = path.join(targetClaudeDir, f);
                    if (fs.existsSync(src)) await fsPromises.copyFile(src, dst);
                }

                // 1. Configure local Toonify MCP server
                const settingsFile = path.join(targetClaudeDir, 'settings.json');
                let settings: any = {};
                if (fs.existsSync(settingsFile)) {
                    try {
                        settings = JSON.parse(await fsPromises.readFile(settingsFile, 'utf-8'));
                    } catch { settings = {}; }
                }
                if (!settings.mcpServers) settings.mcpServers = {};
                
                // Point to the compiled JS file in the container
                settings.mcpServers.toonify = { 
                    command: "node",
                    args: ["/app/dist/mcp-toonify.js"] 
                };
                
                await fsPromises.writeFile(settingsFile, JSON.stringify(settings, null, 2));

                // 2. Create toonify-config.json
                const toonifyConfig = path.join(targetClaudeDir, 'toonify-config.json');
                if (!fs.existsSync(toonifyConfig)) {
                    await fsPromises.writeFile(toonifyConfig, JSON.stringify({
                        "enabled": true,
                        "minTokensThreshold": 50,
                        "minSavingsThreshold": 30,
                        "skipToolPatterns": ["Bash", "Write", "Edit"]
                    }, null, 2));
                }
                
                // CRITICAL: Ensure .credentials.json exists so Claude CLI doesn't ask for /login
                const credsFile = path.join(targetClaudeDir, '.credentials.json');

                if (!fs.existsSync(credsFile)) {
                    await fsPromises.writeFile(credsFile, JSON.stringify({ "token": "dummy", "email": "ralph@duvo.ai" }));
                }
            } catch (e: any) { console.warn("Seed failed: " + e.message); }

            await seedClaudeCache(targetClaudeDir);
            await updateLinearIssue(task.ticketId, "In Progress", "🤖 Ralph started task " + task.ticketId);
            
            await prepareClaudeSkills(workDir, homeDir);
            const availableSkills = await listAvailableSkills(workDir);
            let previousErrors = "";
            for (let i = 0; i < 3; i++) {
                const result = await runIteration(i + 1, { trace, workDir, homeDir, task, availableSkills, git }, previousErrors);
                await persistClaudeCache(targetClaudeDir);
                if (result.success) return;
                previousErrors = result.output || "Unknown error";
            }
            await handleFailureFallback(workDir, homeDir, task, git, previousErrors, 3);
        } finally { cleanup(); }
    });
};