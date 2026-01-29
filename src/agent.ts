import { Langfuse } from "langfuse";
import { setupWorkspace, parseRepoUrl } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LinearClient } from "@linear/sdk";

const langfuse = new Langfuse();

// --- HELPERS ---

async function updateLinearIssue(issueId: string, statusName: string, comment?: string) {
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

        const states = await team.states();
        const targetState = states.nodes.find((s: any) => s.name.toLowerCase() === statusName.toLowerCase());

        if (targetState) {
            console.log(`📡 [Agent] Updating Linear issue ${issueId} to status: ${statusName}`);
            await linear.updateIssue(issueId, { stateId: targetState.id });
        } else {
            const availableStates = states.nodes.map((s: any) => s.name).join(", ");
            console.warn(`⚠️ [Agent] Linear status "${statusName}" not found in team ${team.name}. Available: ${availableStates}`);
        }

        if (comment) {
            console.log(`💬 [Agent] Adding comment to Linear issue ${issueId}`);
            await linear.createComment({ issueId, body: comment });
        }
    } catch (e: any) {
        console.error(`❌ [Agent] Failed to update Linear issue ${issueId}: ${e.message}`);
    }
}

async function createPullRequest(repoUrl: string, branchName: string, title: string, body: string) {
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
function runClaude(args: string[], cwd?: string, timeoutMs: number = 300000): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const CLAUDE_PATH = process.env.CLAUDE_BIN_PATH || '/usr/local/bin/claude';
        
        console.log(`🚀 [Claude CLI] Spawning process: ${CLAUDE_PATH}`);
        console.log(`📂 [Claude CLI] CWD: ${cwd || process.cwd()}`);
        console.log(`📝 [Claude CLI] Args: ${args.join(' ')}`);

        const child = spawn(CLAUDE_PATH, args, { 
            cwd,
            env: { 
                ...process.env, 
                PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                HOME: '/tmp',
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                CI: 'true',
                DEBUG: 'true',
                TERM: 'dumb' // Prevent TTY issues
            }
        });

        // Close stdin to prevent hanging on interactive prompts
        child.stdin.end();

        // Debug process creation
        if (!child.pid) {
            console.error("❌ [Claude CLI] Failed to spawn process! PID is undefined.");
            reject(new Error("Failed to spawn Claude CLI"));
            return;
        }
        console.log(`✅ [Claude CLI] Process spawned with PID: ${child.pid}`);
        
        let stdout = '';
        let stderr = '';

        // Real-time logging
        child.stdout.on('data', (data) => {
            const str = data.toString();
            stdout += str;
            // Log only significant chunks to avoid spamming
            if (str.trim()) console.log(`[Claude STDOUT]: ${str.trim()}`);
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;
            if (str.trim()) console.warn(`[Claude STDERR]: ${str.trim()}`);
        });

        // Timeout handler
        const timeout = setTimeout(() => {
            console.error(`🛑 [Claude CLI] Process ${child.pid} timed out after ${timeoutMs}ms. Killing...`);
            child.kill('SIGKILL');
            reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.on('close', (code) => {
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

        child.on('error', (err) => {
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
        const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
        return dirs
            .filter(d => d.isDirectory())
            .map(d => `- /${d.name}`)
            .join('\n');
    } catch { return "No native skills available."; }
}

// --- TRACING ---
async function withTrace<T>(name: string, metadata: any, fn: (span: any) => Promise<T>) {
    const trace = langfuse.trace({ name, metadata });
    try { return await fn(trace); } 
    catch (e: any) { trace.update({ metadata: { level: "ERROR", error: e.message } }); throw e; } 
    finally { await langfuse.flushAsync(); }
}

// --- AGENT PHASES ---

async function planPhase(workDir: string, task: any, availableSkills: string, previousErrors?: string) {
    // Load CLAUDE.md as the primary project guide
    let projectGuide = "";
    try {
        projectGuide = await fs.readFile(path.join(workDir, 'CLAUDE.md'), 'utf-8');
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

Output format:
<plan>Your detailed plan here</plan>
    `.trim();

    // Planning phase: Opus creates the roadmap
    // CRITICAL: Must pass workDir so Claude knows the context
    // Using explicit 4.5 model IDs found via search
    const { stdout } = await runClaude(['-p', prompt, '--model', 'claude-opus-4-5-20251101'], workDir);
    
    const planRegex = /<plan>([\s\S]*?)<\/plan>/;
    const planMatch = planRegex.exec(stdout);
    return planMatch ? planMatch[1].trim() : "No plan";
}

async function executePhase(workDir: string, plan: string) {
    const prompt = String.raw`
You are the Executor (Claude Sonnet 4.5).
Implement this plan using your native tools and skills:
${plan}

${SECURITY_GUARDRAILS}

Instructions:
1. Follow the plan strictly.
2. Use your native skills if requested in the plan.
3. Verify your work.
4. Do NOT commit.
    `.trim();

    // Execution phase: Sonnet does the work using native CLI capabilities
    return await runClaude(
        ['-p', prompt, '--model', 'claude-sonnet-4-5-20250929', '--allowedTools', 'Bash,Read,Edit,FileSearch,Glob'],
        workDir
    );
}

async function runIteration(iteration: number, trace: any, workDir: string, task: any, availableSkills: string, previousErrors: string, git: any) {
    console.log(`🤖 [Agent] Iteration ${iteration}`);

    // 1. PLAN (Opus)
    const planSpan = trace.span({ 
        name: `Planning-Opus-Iter-${iteration}`,
        metadata: { iteration }
    });
    const plan = await planPhase(workDir, task, availableSkills, previousErrors);
    planSpan.end({ output: plan });

    // 2. EXECUTE (Sonnet)
    const execSpan = trace.span({ 
        name: `Execution-Sonnet-Iter-${iteration}`,
        metadata: { iteration }
    });
    await executePhase(workDir, plan);
    execSpan.end();

    // 3. VALIDATE
    const valSpan = trace.span({ 
        name: `Validation-Iter-${iteration}`,
        metadata: { iteration }
    });
    const check = await runPolyglotValidation(workDir);
    valSpan.end({ output: check });

    if (check.success) {
        console.log("✅ [Agent] Validation passed!");
        
        await git.add('.');
        const status = await git.status();
        if (status.staged.length > 0) {
            await git.commit(`feat: ${task.title}`);
            await git.push('origin', task.branchName, ['--force']);
            
            const prUrl = await createPullRequest(task.repoUrl, task.branchName, `feat: ${task.title}`, task.description || '');
            const successComment = prUrl 
                ? `✅ Task completed successfully.\n\nPull Request: ${prUrl}`
                : `✅ Task completed successfully, but PR creation failed.\n\nChanges pushed to branch: ${task.branchName}`;
            
            await updateLinearIssue(task.ticketId, "In Review", successComment);
            if (prUrl) console.log(`🚀 [Agent] Pull Request created: ${prUrl}`);
        } else {
            console.warn("⚠️ [Agent] Validation passed but no files were changed.");
            await updateLinearIssue(task.ticketId, "Todo", "⚠️ Ralph finished checking the code, but no changes were necessary or made.");
        }
        return { success: true };
    }

    console.warn(`⚠️ [Agent] Validation failed (Iter ${iteration}):\n${check.output}`);
    return { success: false, output: check.output };
}

async function handleFailureFallback(workDir: string, task: any, git: any, previousErrors: string, MAX_RETRIES: number) {
    await git.add('.');
    const finalStatus = await git.status();
    if (finalStatus.staged.length > 0) {
        await git.commit(`wip: ${task.title} (Failed Validation after ${MAX_RETRIES} attempts)`);
        await git.push('origin', task.branchName, ['--force']);
        const wipPrUrl = await createPullRequest(task.repoUrl, task.branchName, `wip: ${task.title}`, `Validation failed after ${MAX_RETRIES} attempts.\n\nErrors:\n${previousErrors}`);
        
        const failComment = wipPrUrl
            ? `❌ Task failed validation after ${MAX_RETRIES} attempts. Changes pushed for inspection.\n\nPull Request: ${wipPrUrl}`
            : `❌ Task failed validation after ${MAX_RETRIES} attempts. Errors:\n${previousErrors}`;
        
        await updateLinearIssue(task.ticketId, "Todo", failComment);
    } else {
        await updateLinearIssue(task.ticketId, "Todo", `❌ Task failed during processing. No changes were made.\n\nErrors:\n${previousErrors}`);
    }
}

export const runAgent = async (task: any) => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace) => {
        const { workDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        try {
            await updateLinearIssue(task.ticketId, "In Progress", "🤖 Ralph has started working on this task.");

            const availableSkills = await listAvailableSkills(workDir);
            let previousErrors = "";
            const MAX_RETRIES = 3;

            for (let i = 0; i < MAX_RETRIES; i++) {
                const result = await runIteration(i + 1, trace, workDir, task, availableSkills, previousErrors, git);
                if (result.success) return;
                previousErrors = result.output || "";
            }

            await handleFailureFallback(workDir, task, git, previousErrors, MAX_RETRIES);

        } finally { cleanup(); }
    });
};
