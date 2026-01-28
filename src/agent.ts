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
async function getAvailableSkills(workDir: string): Promise<string[]> {
    const skillsDir = path.join(workDir, '.ralph', 'skills');
    try {
        const files = await fs.readdir(skillsDir);
        return files.filter(f => f.endsWith('.md'));
    } catch { return []; }
}

async function loadSelectedSkills(workDir: string, selectedFiles: string[]): Promise<string> {
    let skillText = "";
    const skillsDir = path.join(workDir, '.ralph', 'skills');
    for (const file of selectedFiles) {
        try {
            const content = await fs.readFile(path.join(skillsDir, file), 'utf-8');
            skillText += `\n\n--- SKILL: ${file.toUpperCase()} ---\n${content}`;
        } catch { /* ignore missing */ }
    }
    return skillText;
}

// --- TRACING ---
async function withTrace<T>(name: string, metadata: any, fn: (span: any) => Promise<T>) {
    const trace = langfuse.trace({ name, metadata });
    try { return await fn(trace); } 
    catch (e: any) { trace.update({ metadata: { level: "ERROR", error: e.message } }); throw e; } 
    finally { await langfuse.flushAsync(); }
}

// --- AGENT PHASES ---

async function planPhase(workDir: string, task: any, availableSkills: string[], previousErrors?: string) {
    const prompt = String.raw`
You are the Architect/Planner (Claude Opus 4.5). 
Task: ${task.title}
Description: ${task.description}

AVAILABLE SKILLS (Expert project knowledge):
${availableSkills.join('\n')}

${previousErrors ? `⚠️ PREVIOUS ATTEMPT FAILED. Fix these errors:\n${previousErrors}` : ''}

YOUR GOAL:
1. Analyze the task and codebase.
2. Select ONLY the relevant skills from the list above that the Executor will need to succeed.
3. Create a bullet-proof implementation plan.

OUTPUT FORMAT (Must use tags):
<plan>Your detailed step-by-step plan here</plan>
<skills>["relevant-skill.md"]</skills>
    `.trim();

    const { stdout } = await execAsync(`claude -p "${prompt.replaceAll('"', String.raw`\"`)}" --model opus-4-5`);
    
    const planMatch = stdout.match(/<plan>([\s\S]*?)<\/plan>/);
    const skillsMatch = stdout.match(/<skills>([\s\S]*?)<\/skills>/);
    
    return {
        plan: planMatch ? planMatch[1].trim() : "No plan",
        selectedSkills: skillsMatch ? JSON.parse(skillsMatch[1].trim()) : []
    };
}

async function executePhase(workDir: string, task: any, plan: string, skillsContent: string) {
    const prompt = String.raw`
You are the Executor (Claude Sonnet 4.5).
Your task is to implement the following plan:
${plan}

Context/Skills:
${skillsContent}

${SECURITY_GUARDRAILS}

Instructions:
1. Use available tools to modify the code.
2. Verify your work.
3. Do NOT commit.
    `.trim();

    // Sonnet handles the actual work using its toolbelt
    return await execAsync(`claude -p "${prompt.replaceAll('"', String.raw`\"`)}" --model sonnet-4-5 --allowedTools "Bash,Read,Edit,FileSearch,Glob"`, { cwd: workDir });
}

export const runAgent = async (task: any) => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace) => {
        const { workDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        try {
            const availableSkills = await getAvailableSkills(workDir);
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
                const { plan, selectedSkills } = await planPhase(workDir, task, availableSkills, previousErrors);
                planSpan.end({ output: plan, metadata: { selectedSkills } });

                // 2. EXECUTE (Sonnet)
                const skillsContent = await loadSelectedSkills(workDir, selectedSkills);
                const execSpan = trace.span({ 
                    name: `Execution-Sonnet-Iter-${iteration}`,
                    metadata: { 
                        iteration,
                        selectedSkills,
                        skillsContentSnippet: skillsContent.substring(0, 1000)
                    }
                });
                
                await executePhase(workDir, task, plan, skillsContent);
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
                    return; // Success
                }

                console.warn("⚠️ [Agent] Validation failed, retrying...");
                previousErrors = check.output;
            }

            // Final fallback if all retries fail
            await git.add('.'); await git.commit(`wip: ${task.title} (Failed Validation after ${MAX_RETRIES} attempts)`); await git.push('origin', task.branchName);

        } finally { cleanup(); }
    });
};
