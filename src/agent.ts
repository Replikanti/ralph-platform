import { Langfuse } from "langfuse";
import { setupWorkspace } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const langfuse = new Langfuse();

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

    const escapedPrompt = prompt.replaceAll('"', '\"');
    const { stdout } = await execAsync(String.raw`claude -p "${escapedPrompt}" --model opus-4-5`);
    
    const planMatch = stdout.match(/<plan>([\s\S]*?)<\/plan>/);
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

    const escapedPrompt = prompt.replaceAll('"', '\"');
    return await execAsync(String.raw`claude -p "${escapedPrompt}" --model sonnet-4-5 --allowedTools "Bash,Read,Edit,FileSearch,Glob"`, { cwd: workDir });
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
                    return;
                }

                console.warn("⚠️ [Agent] Validation failed, retrying...");
                previousErrors = check.output;
            }

            await git.add('.'); await git.commit(`wip: ${task.title} (Failed Validation after ${MAX_RETRIES} attempts)`); await git.push('origin', task.branchName);

        } finally { cleanup(); }
    });
};