import { Langfuse } from "langfuse";
import { setupWorkspace, parseRepoUrl } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
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
        console.warn("⚠️ LINEAR_API_KEY is missing, skipping status update.");
        return;
    }
    
    try {
        const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
        const issue = await linear.issue(issueId);
        const team = await issue.team;
        if (!team) {
            console.warn(`⚠️ [Agent] No team found for issue ${issueId}`);
            return;
        }

        const targetState = await findTargetState(team, statusName);

        if (targetState) {
            const currentState = await issue.state;
            if (currentState?.id === targetState.id) {
                console.log(`ℹ️ [Agent] Issue ${issueId} is already in state "${statusName}", skipping state update.`);
            } else {
                console.log(`📡 [Agent] Updating Linear issue ${issueId} to status: ${statusName}`);
                await linear.updateIssue(issueId, { stateId: targetState.id });
            }
        } else {
            console.warn(`⚠️ [Agent] Linear status "${statusName}" not found in team ${team.name}.`);
        }

        if (comment) {
            console.log(`💬 [Agent] Adding comment to Linear issue ${issueId}`);
            await linear.createComment({ issueId, body: comment });
        }
    } catch (e: unknown) {
        const error = e as Error;
        console.error(`❌ [Agent] Failed to update Linear issue ${issueId}: ${error.message}`);
    }
}

/**
 * Asks Claude Opus to summarize why the task failed based on the technical errors.
 */
async function summarizeFailurePhase(task: Task, homeDir: string, errors: string): Promise<string> {
    const prompt = `
You are the Post-Mortem Analyst (Claude Opus 4.5).
The AI coding agent "Ralph" failed to complete a task. 

TASK: ${task.title}
ERRORS ENCOUNTERED:
${errors.substring(0, 5000)}

YOUR GOAL:
Write a concise, human-friendly explanation (2-3 sentences) for the developer explaining:
1. What Ralph was trying to do.
2. Why it failed (e.g., zacyklení na TSC chybách, chybějící soubor).
3. Suggest what a human should do next.

Format your response as a direct comment to the user.
`.trim();

    try {
        // Post-mortem can run in the same isolated homeDir
        const { stdout } = await runClaude(['-p', prompt, '--model', 'claude-opus-4-5-20251101'], process.cwd(), homeDir);
        return stdout.trim();
    } catch {
        return "Task failed due to persistent validation errors that Ralph couldn't resolve automatically.";
    }
}

async function createPullRequest(repoUrl: string, branchName: string, title: string, body: string): Promise<string | null> {
    const { owner, repo } = parseRepoUrl(repoUrl);
    try {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        
        // Check if there are actually commits to PR
        // This prevents the "No commits between main and branch" error
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
            console.warn("⚠️ [Agent] Skipping PR creation: No changes detected between branches.");
            return null;
        }
        if (e.message?.includes('A pull request already exists')) {
            const { Octokit } = await import("@octokit/rest");
            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            const prs = await octokit.rest.pulls.list({
                owner,
                repo,
                head: `${owner}:${branchName}`,
                state: 'open'
            });
            return prs.data[0]?.html_url;
        }
        console.error("❌ [Agent] Failed to create Pull Request:", e.message);
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
        
        console.log(`🚀 [Claude CLI] Spawning process: ${CLAUDE_PATH}`);
        console.log(`📂 [Claude CLI] CWD: ${cwd}`);
        console.log(`🏠 [Claude CLI] HOME: ${homeDir}`);
        console.log(`📝 [Claude CLI] Args: ${args.join(' ')}`);

        const child = spawn(CLAUDE_PATH, args, { 
            cwd,
            env: { 
                ...process.env, 
                PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                HOME: homeDir,
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                CI: 'true',
                DEBUG: 'true',
                TERM: 'dumb' // Prevent TTY issues
            }
        });

        // Close stdin to prevent hanging on interactive prompts
        if (child.stdin) child.stdin.end();

        // Debug process creation
        if (!child.pid) {
            console.error("❌ [Claude CLI] Failed to spawn process! PID is undefined.");
            reject(new Error("Failed to spawn Claude CLI"));
            return;
        }
        console.log(`✅ [Claude CLI] Process spawned with PID: ${child.pid}`);
        
        let stdout: string = '';
        let stderr: string = '';

        // Real-time logging
        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
                const str = data.toString();
                stdout += str;
                // Log only significant chunks to avoid spamming
                if (str.trim()) console.log(`[Claude STDOUT]: ${str.trim()}`);
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                const str = data.toString();
                stderr += str;
                if (str.trim()) console.warn(`[Claude STDERR]: ${str.trim()}`);
            });
        }

        // Timeout handler
        const timeout = setTimeout(() => {
            console.error(`🛑 [Claude CLI] Process ${child.pid} timed out after ${timeoutMs}ms. Killing...`);
            child.kill('SIGKILL');
            reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.on('close', (code: number) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const err = new Error(`Claude CLI exited with code ${code}`);
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

// --- SECURITY GUARDRAILS ---
const SECURITY_GUARDRAILS = `
### 🛡️ SECURITY RULES
1. NO SECRETS: Never output API keys.
2. SANDBOX: Only modify files inside the workspace.
`.trim();

// --- SKILLS MANAGEMENT ---

async function listAvailableSkills(workDir: string): Promise<string> {
    // List native skills from .claude/skills so the Planner knows what's available
    const skillsDir = path.join(workDir, '.claude', 'skills');
    try {
        const dirs = await fsPromises.readdir(skillsDir, { withFileTypes: true });
        return dirs
            .filter((d: fs.Dirent) => d.isDirectory())
            .map((d: fs.Dirent) => `- /${d.name}`)
            .join('\n');
    } catch { return "No native skills available."; }
}

// --- TRACING ---
async function withTrace<T>(name: string, metadata: Record<string, any>, fn: (span: any) => Promise<T>) {
    const trace = langfuse.trace({ name, metadata });
    try { return await fn(trace); } 
    catch (e: unknown) { 
        const error = e as Error;
        trace.update({ metadata: { level: "ERROR", error: error.message } }); throw e; 
    } 
    finally { await langfuse.flushAsync(); }
}

// --- AGENT PHASES ---

async function planPhase(workDir: string, homeDir: string, task: any, availableSkills: string, previousErrors?: string) {
    // Load CLAUDE.md as the primary project guide
    let projectGuide = "";
    try {
        projectGuide = await fsPromises.readFile(path.join(workDir, 'CLAUDE.md'), 'utf-8');
    } catch {
        projectGuide = "No CLAUDE.md found. Use general knowledge.";
    }

    const prompt = String.raw`
You are the Architect/Planner (Claude Opus 4.5). 
Your task is to create an implementation plan for the Executor.

PROJECT GUIDE (CLAUDE.md):
${projectGuide}

AVAILABLE NATIVE SKILLS (Mention them in your plan if needed):
${availableSkills}

TASK: ${task.title}
DESCRIPTION: ${task.description}

${previousErrors ? `⚠️ PREVIOUS ATTEMPT FAILED. Fix these errors:
${previousErrors}` : ''}

YOUR GOAL:
1. Create a detailed step-by-step implementation plan.
2. Explicitly mention which native skills (/name) the Executor should invoke.
3. Do NOT modify any files.
4. FOCUS: Only address the task described above. Do NOT "fix" unrelated bugs or reformat files that are not part of the required changes. However, you ARE expected to modify the platform's core logic (e.g., agent.ts, server.ts, tools.ts) if the task explicitly requires architectural changes or new features.

Output format:
<plan>Your detailed plan here</plan>
    `.trim();

    // Planning phase: Opus creates the roadmap
    // CRITICAL: Must pass workDir so Claude knows the context
    // Using explicit 4.5 model IDs found via search
    const { stdout } = await runClaude(['-p', prompt, '--model', 'claude-opus-4-5-20251101'], workDir, homeDir);
    
    const planRegex = /<plan>([\s\S]*?)<\/plan>/;
    const planMatch = planRegex.exec(stdout);
    return planMatch ? planMatch[1].trim() : "No plan";
}

async function executePhase(workDir: string, homeDir: string, plan: string) {
    const prompt = String.raw`
You are the Executor (Claude Sonnet 4.5).
Implement this plan using your native tools and skills:
${plan}

${SECURITY_GUARDRAILS}

Instructions:
1. Follow the plan strictly.
2. Only modify files that are absolutely necessary to implement the requested task.
3. Do NOT "fix" or reformat unrelated files. If you see errors in unrelated files, IGNORE them. You are encouraged to modify the platform's core code (agent.ts, server.ts, etc.) when the task requires implementing new system capabilities or refactoring the workflow.
4. Use your native skills if requested in the plan.
5. Verify your work.
6. Do NOT commit.
    `.trim();

    // Execution phase: Sonnet does the work using native CLI capabilities
    return await runClaude(
        ['-p', prompt, '--model', 'claude-sonnet-4-5-20250929', '--allowedTools', 'Bash,Read,Edit,FileSearch,Glob'],
        workDir,
        homeDir
    );
}

/**
 * Ensures that skills from the repository are available to the Claude CLI.
 * Copies skills from the repository's .claude/skills directory to the Claude home directory.
 */
async function prepareClaudeSkills(workDir: string, homeDir: string) {
    const targetSkillsDir = path.join(homeDir, '.claude', 'skills');
    const sourceSkillsDir = path.join(workDir, '.claude', 'skills');

    try {
        if (await fsPromises.stat(sourceSkillsDir).then(() => true).catch(() => false)) {
            await fsPromises.mkdir(targetSkillsDir, { recursive: true });
            await fsPromises.cp(sourceSkillsDir, targetSkillsDir, { recursive: true });
            console.log(`✅ [Agent] Loaded repository skills into isolated Claude environment`);
        }
    } catch (e: any) {
        console.warn(`⚠️ [Agent] Failed to load skills into environment: ${e.message}`);
    }
}

async function runIteration(iteration: number, ctx: IterationContext, previousErrors: string): Promise<{ success: boolean, output?: string }> {
    console.log(`🤖 [Agent] Iteration ${iteration}`);

    // 1. PLAN (Opus)
    const planSpan = ctx.trace.span({
        name: `Planning-Opus-Iter-${iteration}`,
        metadata: { iteration }
    });
    const rawPlan = await planPhase(ctx.workDir, ctx.homeDir, ctx.task, ctx.availableSkills, previousErrors);
    // Strip XML tags if present to prevent Executor confusion
    const plan = rawPlan.replaceAll('<plan>', '').replaceAll('</plan>', '').trim();
    planSpan.end({ output: plan });

    // 2. EXECUTE (Sonnet)
    const execSpan = ctx.trace.span({
        name: `Execution-Sonnet-Iter-${iteration}`,
        metadata: { iteration }
    });
    await executePhase(ctx.workDir, ctx.homeDir, plan);
    execSpan.end();

    // 3. VALIDATE
    const valSpan = ctx.trace.span({
        name: `Validation-Iter-${iteration}`,
        metadata: { iteration }
    });
    const check = await runPolyglotValidation(ctx.workDir);
    valSpan.end({ output: check });

    if (check.success) {
        console.log("✅ [Agent] Validation passed!");
        
        await ctx.git.add('.');
        const status = await ctx.git.status();
        if (status.staged.length > 0) {
            await ctx.git.commit(`feat: ${ctx.task.title}`);
            await ctx.git.push('origin', ctx.task.branchName, ['--force']);
            
            const prUrl = await createPullRequest(ctx.task.repoUrl, ctx.task.branchName, `feat: ${ctx.task.title}`, ctx.task.description || '');
            const successComment = prUrl 
                ? `✅ Task completed successfully.\n\nPull Request: ${prUrl}`
                : `✅ Task completed successfully, but PR creation failed.\n\nChanges pushed to branch: ${ctx.task.branchName}`;
            
            await updateLinearIssue(ctx.task.ticketId, "In Review", successComment);
            if (prUrl) console.log(`🚀 [Agent] Pull Request created: ${prUrl}`);
        } else {
            console.warn("⚠️ [Agent] Validation passed but no files were changed.");
            await updateLinearIssue(ctx.task.ticketId, "Todo", "⚠️ Ralph finished checking the code, but no changes were necessary or made.");
        }
        return { success: true };
    }

    console.warn(`⚠️ [Agent] Validation failed (Iter ${iteration}):\n${check.output}`);
    return { success: false, output: check.output };
}

async function handleFailureFallback(workDir: string, homeDir: string, task: Task, git: any, previousErrors: string, MAX_RETRIES: number): Promise<void> {
    console.warn(`🛑 [Agent] Task failed after ${MAX_RETRIES} attempts. Generating explanation...`);
    
    const explanation = await summarizeFailurePhase(task, homeDir, previousErrors);
    const failComment = `❌ **Task failed after ${MAX_RETRIES} attempts.**\n\n${explanation}\n\n---\n**Technical Details:**\n\`\`\`\n${previousErrors.substring(0, 1000)}...\n\`\`\``;
    
    // Reset ticket to unstarted state and add explanation
    await updateLinearIssue(task.ticketId, "Todo", failComment);
    
    // We do NOT push to git anymore when it's a known failure. 
    // The workspace will be cleaned up, leaving the repo clean.
}

export const runAgent = async (task: Task): Promise<void> => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace: any) => {
        const { workDir, rootDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        const homeDir = path.join(rootDir, 'home');
        
        try {
            // Smart notification based on attempt number
            if (task.attempt > 1) {
                await updateLinearIssue(task.ticketId, "In Progress", `🔄 **Retrying task (Attempt ${task.attempt}/${task.maxAttempts})**\nJob ID: 
${task.jobId}
`);
            } else {
                await updateLinearIssue(task.ticketId, "In Progress", `🤖 **Ralph has started working on this task.**\nJob ID: 
${task.jobId}
`);
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
