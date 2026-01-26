import { Anthropic } from "@anthropic-ai/sdk";
import { Langfuse } from "langfuse";
import { setupWorkspace } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fs from 'node:fs/promises';
import path from 'node:path';

const anthropic = new Anthropic();
const langfuse = new Langfuse();

// --- IMMUTABLE SECURITY LAYER ---
const SECURITY_GUARDRAILS = `
### 🛡️ CRITICAL SECURITY RULES (OVERRIDE ALL)
1. NO SECRETS: Never output API keys or tokens.
2. NO DESTRUCTION: Do not delete config files or infrastructure.
3. SANDBOX: Only modify files inside the workspace.
4. DEPENDENCIES: Do not install unverified packages.
`;

// --- MUTABLE SKILL LAYER ---
async function loadRepoSkills(workDir: string): Promise<string> {
    const skillsDir = path.join(workDir, '.ralph', 'skills');
    let skillText = "";
    try {
        await fs.access(skillsDir);
        const files = await fs.readdir(skillsDir);
        for (const file of files) {
            if (file.endsWith('.md')) {
                const content = await fs.readFile(path.join(skillsDir, file), 'utf-8');
                skillText += `\n\n--- REPO SKILL: ${file.toUpperCase()} ---\n${content}`;
            }
        }
    } catch (error_) { 
        if (error_ instanceof Error && (error_ as any).code === 'ENOENT') {
            return ""; 
        }
        console.error("Unexpected error loading repository skills:", error_);
    }
    return skillText;
}

// Trace Wrapper
async function withTrace<T>(name: string, metadata: any, fn: (span: any) => Promise<T>) {
    const trace = langfuse.trace({ name, metadata });
    try { return await fn(trace); } 
    catch (e: any) { trace.update({ metadata: { level: "ERROR", error: e.message } }); throw e; } 
    finally { await langfuse.flushAsync(); }
}

export const runAgent = async (task: any) => {
    return withTrace("Ralph-Task", { ticketId: task.ticketId }, async (trace) => {
        const { workDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);
        try {
            const repoSkills = await loadRepoSkills(workDir);
            const systemPrompt = `You are Ralph, a Senior Engineer.\n${SECURITY_GUARDRAILS}\n${repoSkills}`;

            // 1. PLAN (Opus)
            const planSpan = trace.span({ name: "Planning", model: "claude-3-opus" });
            const planMsg = await anthropic.messages.create({
                model: "claude-3-opus-20240229", max_tokens: 2000, system: systemPrompt,
                messages: [{ role: "user", content: `Task: ${task.title}\n${task.description}` }]
            });
            const plan = planMsg.content[0].text;
            planSpan.end({ output: plan });

            // 2. EXECUTE (Sonnet)
            const execSpan = trace.span({ name: "Coding", model: "claude-3-5-sonnet" });
            const codeMsg = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20240620", max_tokens: 4000, system: systemPrompt,
                messages: [{ role: "user", content: `Plan: ${plan}\nWorkspace: ${workDir}\nImplement this.` }]
            });
            execSpan.end({ output: codeMsg.content[0].text });
            // (Simulated file writing here based on LLM output)

            // 3. VALIDATE (Polyglot)
            const valSpan = trace.span({ name: "Validation" });
            const check = await runPolyglotValidation(workDir);
            valSpan.end({ output: check });

            // 4. PUSH
            if (check.success) {
                await git.add('.'); await git.commit(`feat: ${task.title}`); await git.push('origin', task.branchName);
            } else {
                await git.add('.'); await git.commit(`wip: ${task.title} (Failed Validation)`); await git.push('origin', task.branchName);
            }
        } finally { cleanup(); }
    });
};
