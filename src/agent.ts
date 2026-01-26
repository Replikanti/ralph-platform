import { Anthropic } from "@anthropic-ai/sdk";
import { Langfuse } from "langfuse";
import { setupWorkspace } from "./workspace";
import { 
    runPolyglotValidation, 
    agentTools, 
    listFiles, 
    readFile, 
    writeFile, 
    runCommand 
} from "./tools";
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
            const systemPrompt = `You are Ralph, a Senior Engineer.\n${SECURITY_GUARDRAILS}\n${repoSkills}\nYou have access to tools to read, write, and execute code. Use them to implement the plan.`;

            // 1. PLAN (Opus)
            const planSpan = trace.span({ name: "Planning", model: "claude-opus-4-5" });
            const planMsg = await anthropic.messages.create({
                model: "claude-opus-4-5", max_tokens: 2000, system: systemPrompt,
                messages: [{ role: "user", content: `Task: ${task.title}\n${task.description}\n\nAnalyze the task and create a step-by-step implementation plan.` }]
            });
            const planBlock = planMsg.content[0];
            const plan = planBlock.type === 'text' ? planBlock.text : "No plan generated";
            planSpan.end({ output: plan });

            // 2. EXECUTE (Sonnet) - Agentic Loop
            const execSpan = trace.span({ name: "Coding", model: "claude-sonnet-4-5" });
            
            let messages: any[] = [
                { role: "user", content: `Plan: ${plan}\nWorkspace: ${workDir}\n\nImplement this plan using the available tools.` }
            ];

            const MAX_ITERATIONS = 15;
            let finalOutput = "";

            for (let i = 0; i < MAX_ITERATIONS; i++) {
                console.log(`🤖 [Agent] Iteration ${i + 1}/${MAX_ITERATIONS}`);
                
                const response = await anthropic.messages.create({
                    model: "claude-sonnet-4-5",
                    max_tokens: 4000,
                    system: systemPrompt,
                    tools: agentTools as any,
                    messages: messages
                });

                // Append assistant response to history
                messages.push({ role: "assistant", content: response.content });

                // Check for tool use
                const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
                
                if (toolUseBlocks.length === 0) {
                    // No tools used, assuming completion or question
                    const textBlock = response.content.find(b => b.type === 'text');
                    finalOutput = textBlock ? textBlock.text : "No output";
                    console.log("✅ [Agent] Finished execution loop.");
                    break;
                }

                // Process tool calls
                const toolResults = [];
                for (const block of toolUseBlocks) {
                    const input = block.input as any;
                    let result = "";
                    console.log(`🛠️ [Agent] Tool Call: ${block.name}`);

                    try {
                        switch (block.name) {
                            case 'list_files':
                                result = await listFiles(workDir, input.path);
                                break;
                            case 'read_file':
                                result = await readFile(workDir, input.path);
                                break;
                            case 'write_file':
                                result = await writeFile(workDir, input.path, input.content);
                                break;
                            case 'run_command':
                                result = await runCommand(workDir, input.command);
                                break;
                            default:
                                result = `Error: Unknown tool ${block.name}`;
                        }
                    } catch (e: any) {
                        result = `Error executing tool: ${e.message}`;
                    }

                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: result
                    });
                }

                // Append tool results to history
                messages.push({ role: "user", content: toolResults });
            }

            execSpan.end({ output: finalOutput });

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
