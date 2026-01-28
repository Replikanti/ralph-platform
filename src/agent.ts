import { Langfuse } from "langfuse";
import { setupWorkspace } from "./workspace";
import { runPolyglotValidation } from "./tools";
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
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
    } catch (error_: any) { 
        if (error_.code === 'ENOENT') {
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
            
            // Construct the prompt for Claude Code CLI
            const prompt = `
Task: ${task.title}
${task.description}

${SECURITY_GUARDRAILS}

${repoSkills}

Instructions:
1. Analyze the codebase.
2. Implement the requested changes.
3. Run tests if available to verify your changes.
4. Do NOT commit changes, just modify the files.
            `.trim();

            // Execute Claude Code in headless mode (-p)
            const execSpan = trace.span({ name: "Claude-CLI-Execution" });
            console.log(`🤖 [Agent] Starting Claude Code CLI...`);
            
            try {
                // Using -p for non-interactive mode (print output)
                // --allowedTools limits what it can do (security)
                // We pass the prompt as an argument
                const { stdout, stderr } = await execAsync(
                    `claude -p "${prompt.replace(/"/g, '\\"')}" --allowedTools "Bash,Read,Edit,FileSearch,Glob"`, 
                    { 
                        cwd: workDir,
                        timeout: 300000, // 5 minutes timeout
                        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
                    }
                );
                
                console.log("✅ [Agent] Claude CLI finished.");
                execSpan.end({ output: stdout, stderr: stderr });
            } catch (e: any) {
                console.error("❌ [Agent] Claude CLI failed:", e);
                execSpan.end({ error: e.message, stderr: e.stderr });
                throw e; // Rethrow to mark task as failed
            }

            // 3. VALIDATE (Polyglot) - Double check with our tools
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
