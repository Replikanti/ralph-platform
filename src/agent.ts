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
    
    // 1. Direct match
    let state = states.nodes.find((s: { name: string, id: string }) => s.name.toLowerCase() === name);
    if (state) return state;

    // 2. Synonym mapping for common states
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
    if (!process.env.LINEAR_API_KEY) {
        console.warn("LINEAR_API_KEY is missing, skipping status update.");
        return;
    }
    
    try {
        const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
        const issue = await linear.issue(issueId);
        const team = await issue.team;
        if (!team) {
            console.warn("No team found for issue " + issueId);
            return;
        }

        const targetState = await findTargetState(team, statusName);

        if (targetState) {
            const currentState = await issue.state;
            if (currentState?.id === targetState.id) {
                console.log("Issue " + issueId + " is already in state " + statusName + ", skipping state update.");
            } else {
                console.log("Updating Linear issue " + issueId + " to status: " + statusName);
                await linear.updateIssue(issueId, { stateId: targetState.id });
            }
        } else {
            console.warn("Linear status " + statusName + " not found in team " + team.name + ".");
        }

        if (comment) {
            console.log("Adding comment to Linear issue " + issueId);
            await linear.createComment({ issueId, body: comment });
        }
    } catch (e: unknown) {
        const error = e as Error;
        console.error("Failed to update Linear issue " + issueId + ": " + error.message);
    }
}

/**
 * Asks Claude Opus to summarize why the task failed based on the technical errors.
 */
async function summarizeFailurePhase(task: Task, homeDir: string, errors: string): Promise<string> {
    const prompt = "You are the Post-Mortem Analyst (Claude Opus 4.5). " +
        "The AI coding agent Ralph failed to complete a task. " +
        "TASK: " + task.title + " " +
        "ERRORS ENCOUNTERED: " + errors.substring(0, 5000) + " " +
        "Write a concise, human-friendly explanation (2-3 sentences) for the developer.";

    try {
        // Post-mortem can run in the same isolated homeDir
        const { stdout } = await runClaude(['-p', prompt, '--model', 'claude-opus-4-5-20251101'], process.cwd(), homeDir);
        return stdout.trim();
    } catch {
        return "Task failed due to persistent validation errors that Ralph could not resolve automatically.";
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
        if (e.message?.includes('No commits between')) {
            console.warn("Skipping PR creation: No changes detected between branches.");
            return null;
        }
        console.error("Failed to create Pull Request: " + e.message);
        return null;
    }
}

/**
 * Executes Claude CLI using spawn to safely handle multi-line prompts and avoid shell escaping issues.
 * Now supports real-time logging and timeouts.
 */
function runClaude(args: string[], cwd: string, homeDir: string, timeoutMs: number = 300000): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const CLAUDE_PATH = process.env.CLAUDE_BIN_PATH || '/usr/local/bin/claude';
        
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
        
        let stdout: string = '';
        let stderr: string = '';

        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
                const str = data.toString();
                stdout += str;
                if (str.trim()) console.log("[Claude STDOUT]: " + str.trim());
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                const str = data.toString();
                stderr += str;
                if (str.trim()) console.warn("[Claude STDERR]: " + str.trim());
            });
        }

        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error("Claude CLI timed out after " + timeoutMs + "ms"));
        }, timeoutMs);

        child.on('close', (code: number) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                console.error("Claude CLI failed with code " + code);
                console.error("STDOUT: " + stdout);
                console.error("STDERR: " + stderr);
                const combined = (stderr + " " + stdout).trim();
                const err = new Error("Claude CLI exited with code " + code + ". Output: " + combined.substring(0, 500));
                (err as any).stdout = stdout;
                (err as any).stderr = stderr;
                reject(err);
            }
        });

        child.on('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

const SECURITY_GUARDRAILS = "SECURITY RULES: 1. NO SECRETS. 2. SANDBOX.";

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
    catch (e: unknown) { 
        const error = e as Error;
        trace.update({ metadata: { level: "ERROR", error: error.message } }); throw e; 
    } 
    finally { await langfuse.flushAsync(); }
}

async function planPhase(workDir: string, homeDir: string, task: any, availableSkills: string, previousErrors?: string) {
    let projectGuide = "";
    try {
        projectGuide = await fsPromises.readFile(path.join(workDir, 'CLAUDE.md'), 'utf-8');
    } catch {
        projectGuide = "No CLAUDE.md found.";
    }

    const prompt = "Create implementation plan for: " + task.title + " " +
        "Description: " + task.description + " " +
        "Skills: " + availableSkills + " " +
        (previousErrors ? "Previous errors: " + previousErrors : "") + " " +
        "Use <plan> tags for output.";

    const { stdout } = await runClaude(['-p', prompt, '--model', 'claude-opus-4-5-20251101'], workDir, homeDir);
    
    const planRegex = /<plan>([\s\S]*?)<\/plan>/;
    const planMatch = planRegex.exec(stdout);
    return planMatch ? planMatch[1].trim() : "No plan";
}

async function executePhase(workDir: string, homeDir: string, plan: string) {
    const prompt = "Implement plan: " + plan + " " + SECURITY_GUARDRAILS;
    return await runClaude(
        [
            '-p', prompt, 
            '--model', 'claude-sonnet-4-5-20250929', 
            '--allowedTools', 'Bash,Read,Edit,FileSearch,Glob',
            '--dangerously-skip-permissions',
            '--permission-mode', 'bypassPermissions'
        ],
        workDir,
        homeDir
    );
}

async function prepareClaudeSkills(workDir: string, homeDir: string) {
    const targetSkillsDir = path.join(homeDir, '.claude', 'skills');
    const sourceSkillsDir = path.join(workDir, '.claude', 'skills');

    try {
        if (await fsPromises.stat(sourceSkillsDir).then(() => true).catch(() => false)) {
            await fsPromises.mkdir(targetSkillsDir, { recursive: true });
            await fsPromises.cp(sourceSkillsDir, targetSkillsDir, { recursive: true });
            console.log("Loaded skills into environment");
        }
    } catch (e: any) {
        console.warn("Failed to load skills: " + e.message);
    }
}

async function runIteration(iteration: number, ctx: IterationContext, previousErrors: string): Promise<{ success: boolean, output?: string }> {
    console.log("Iteration " + iteration);

    const planSpan = ctx.trace.span({
        name: "Planning",
        metadata: { iteration }
    });
    const rawPlan = await planPhase(ctx.workDir, ctx.homeDir, ctx.task, ctx.availableSkills, previousErrors);
    const plan = rawPlan.replaceAll('<plan>', '').replaceAll('</plan>', '').trim();
    planSpan.end({ output: plan });

    const execSpan = ctx.trace.span({
        name: "Execution",
        metadata: { iteration }
    });
    await executePhase(ctx.workDir, ctx.homeDir, plan);
    execSpan.end();

    const check = await runPolyglotValidation(ctx.workDir);

    if (check.success) {
        await ctx.git.add('.');
        const status = await ctx.git.status();
        if (status.staged.length > 0) {
            await ctx.git.commit("feat: " + ctx.task.title);
            await ctx.git.push('origin', ctx.task.branchName, ['--force']);
            
            const prUrl = await createPullRequest(ctx.task.repoUrl, ctx.task.branchName, "feat: " + ctx.task.title, ctx.task.description || '');
            const successComment = prUrl 
                ? "Task completed. PR: " + prUrl
                : "Task completed. PR failed but changes pushed to " + ctx.task.branchName;
            
            await updateLinearIssue(ctx.task.ticketId, "In Review", successComment);
        } else {
            console.warn("No files changed.");
            await updateLinearIssue(ctx.task.ticketId, "Todo", "No changes made.");
        }
        return { success: true };
    }

    return { success: false, output: check.output };
}

async function handleFailureFallback(workDir: string, homeDir: string, task: Task, git: any, previousErrors: string, MAX_RETRIES: number): Promise<void> {
    const explanation = await summarizeFailurePhase(task, homeDir, previousErrors);
    const failComment = "Task failed after " + MAX_RETRIES + " attempts. " + explanation;
    await updateLinearIssue(task.ticketId, "Todo", failComment);
}

export const runAgent = async (task: Task): Promise<void> => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace: any) => {
        const { workDir, rootDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        const homeDir = path.join(rootDir, 'home');
        const targetClaudeDir = path.join(homeDir, '.claude');
        
        try {
            const sourceClaudeDir = path.join(os.homedir(), '.claude');
            await fsPromises.mkdir(targetClaudeDir, { recursive: true });
            
            try {
                const itemsToCopy = ['.credentials.json', 'settings.json', 'settings.local.json'];
                for (const item of itemsToCopy) {
                    const src = path.join(sourceClaudeDir, item);
                    const dst = path.join(targetClaudeDir, item);
                    if (fs.existsSync(src)) {
                        await fsPromises.copyFile(src, dst);
                    }
                }
                
                // CRITICAL: Ensure .credentials.json exists so Claude CLI doesn't ask for /login
                const credsFile = path.join(targetClaudeDir, '.credentials.json');
                if (!fs.existsSync(credsFile)) {
                    await fsPromises.writeFile(credsFile, JSON.stringify({
                        "token": "sk-ant-dummy-token",
                        "email": "ralph@duvo.ai"
                    }));
                }
                
                console.log("Seeded isolated Claude config");
            } catch (e: any) {
                console.warn("Seed failed: " + e.message);
            }

            if (task.attempt > 1) {
                await updateLinearIssue(task.ticketId, "In Progress", "Retrying attempt " + task.attempt);
            } else {
                await updateLinearIssue(task.ticketId, "In Progress", "Ralph started.");
            }

            await prepareClaudeSkills(workDir, homeDir);
            const availableSkills = await listAvailableSkills(workDir);
            let previousErrors = "";
            const MAX_RETRIES = 3;

            const ctx: IterationContext = { trace, workDir, homeDir, task, availableSkills, git };

            for (let i = 0; i < MAX_RETRIES; i++) {
                const result = await runIteration(i + 1, ctx, previousErrors);
                if (result.success) return;
                previousErrors = result.output || "";
            }

            await handleFailureFallback(workDir, homeDir, task, git, previousErrors, MAX_RETRIES);

        } finally { cleanup(); }
    });
};