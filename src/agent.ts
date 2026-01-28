import { Langfuse } from "langfuse";
import { setupWorkspace, parseRepoUrl } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const langfuse = new Langfuse();

// --- HELPERS ---

async function createPullRequest(repoUrl: string, branchName: string, title: string, body: string) {
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
            base: 'main', // Assuming main is the default branch
        });
        return response.data.html_url;
    } catch (e: any) {
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
 */
function runClaude(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        // SECURITY: Use absolute path from env or fixed default to prevent injection
        const CLAUDE_PATH = process.env.CLAUDE_BIN_PATH || '/usr/local/bin/claude';
        
        const child = spawn(CLAUDE_PATH, args, { 
            cwd,
            env: { 
                ...process.env, 
                // Fixed PATH for security
                PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                // Set HOME to a writable directory for Claude config/cache
                HOME: '/tmp',
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY 
            }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
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
    const { stdout } = await runClaude(['-p', prompt, '--model', 'opus-4-5']);
    
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
        ['-p', prompt, '--model', 'sonnet-4-5', '--allowedTools', 'Bash,Read,Edit,FileSearch,Glob'],
        workDir
    );
}

export const runAgent = async (task: any) => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace) => {
        const { workDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        try {
            const availableSkills = await listAvailableSkills(workDir);
            let previousErrors = "";
            const MAX_RETRIES = 3;

            for (let i = 0; i < MAX_RETRIES; i++) {
                const iteration = i + 1;
                console.log(`🤖 [Agent] Iteration ${iteration}/${MAX_RETRIES}`);

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
                    await git.add('.'); await git.commit(`feat: ${task.title}`); await git.push('origin', task.branchName);
                    
                    // Create Pull Request
                    const prUrl = await createPullRequest(task.repoUrl, task.branchName, `feat: ${task.title}`, task.description || '');
                    if (prUrl) {
                        console.log(`🚀 [Agent] Pull Request created: ${prUrl}`);
                    }
                    return;
                }

                console.warn("⚠️ [Agent] Validation failed, retrying...");
                previousErrors = check.output;
            }

            // Final fallback if all retries fail
            await git.add('.'); await git.commit(`wip: ${task.title} (Failed Validation after ${MAX_RETRIES} attempts)`); await git.push('origin', task.branchName);
            
            // Create WIP Pull Request even if validation failed
            const prUrl = await createPullRequest(task.repoUrl, task.branchName, `wip: ${task.title}`, `Validation failed after multiple attempts.\n\nErrors:\n${previousErrors}`);
            if (prUrl) {
                console.log(`🚀 [Agent] WIP Pull Request created: ${prUrl}`);
            }

        } finally { cleanup(); }
    });
};
