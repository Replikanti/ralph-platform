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

// --- TELEMETRY TYPES ---
interface ToolCallMetrics {
    name: string;
    path?: string;        // For file operations
    command?: string;     // For run_command (sanitized)
    durationMs: number;
    success: boolean;
}

interface IterationMetrics {
    iteration: number;
    toolCalls: ToolCallMetrics[];
    durationMs: number;
}

interface LoopTelemetry {
    iterations: IterationMetrics[];
    totalIterations: number;
    finishReason: 'NO_TOOL_USE' | 'MAX_ITERATIONS' | 'ERROR';
    toolCallsByName: Record<string, number>;
    repeatedReads: Record<string, number>;    // path -> count
    repeatedCommands: Record<string, number>; // command -> count
    totalDurationMs: number;
}

// --- TELEMETRY HELPERS ---
function createTelemetryCollector(): {
    telemetry: LoopTelemetry;
    startIteration: (i: number) => { endIteration: () => void; recordToolCall: (metrics: ToolCallMetrics) => void };
    setFinishReason: (reason: LoopTelemetry['finishReason']) => void;
} {
    const telemetry: LoopTelemetry = {
        iterations: [],
        totalIterations: 0,
        finishReason: 'NO_TOOL_USE',
        toolCallsByName: {},
        repeatedReads: {},
        repeatedCommands: {},
        totalDurationMs: 0
    };

    const loopStart = Date.now();

    return {
        telemetry,
        startIteration: (i: number) => {
            const iterStart = Date.now();
            const iterMetrics: IterationMetrics = {
                iteration: i + 1,
                toolCalls: [],
                durationMs: 0
            };

            return {
                endIteration: () => {
                    iterMetrics.durationMs = Date.now() - iterStart;
                    telemetry.iterations.push(iterMetrics);
                    telemetry.totalIterations = i + 1;
                    telemetry.totalDurationMs = Date.now() - loopStart;
                },
                recordToolCall: (metrics: ToolCallMetrics) => {
                    iterMetrics.toolCalls.push(metrics);

                    // Aggregate by tool name
                    telemetry.toolCallsByName[metrics.name] =
                        (telemetry.toolCallsByName[metrics.name] || 0) + 1;

                    // Track repeated reads
                    if (metrics.name === 'read_file' && metrics.path) {
                        telemetry.repeatedReads[metrics.path] =
                            (telemetry.repeatedReads[metrics.path] || 0) + 1;
                    }

                    // Track repeated commands
                    if (metrics.name === 'run_command' && metrics.command) {
                        telemetry.repeatedCommands[metrics.command] =
                            (telemetry.repeatedCommands[metrics.command] || 0) + 1;
                    }
                }
            };
        },
        setFinishReason: (reason) => {
            telemetry.finishReason = reason;
        }
    };
}

async function writeTelemetryArtifact(
    workDir: string,
    telemetry: LoopTelemetry,
    validationSuccess: boolean
): Promise<void> {
    const artifactDir = path.join(workDir, '.ralph', 'telemetry');
    const artifactPath = path.join(artifactDir, 'last_run.json');

    // Filter to top repeated items (no sensitive data)
    const artifact = {
        timestamp: new Date().toISOString(),
        iterations_used: telemetry.totalIterations,
        finish_reason: telemetry.finishReason,
        total_duration_ms: telemetry.totalDurationMs,
        tool_calls_by_name: telemetry.toolCallsByName,
        top_repeated_reads: Object.entries(telemetry.repeatedReads)
            .filter(([_, count]) => count > 1)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([path, count]) => ({ path, count })),
        top_repeated_commands: Object.entries(telemetry.repeatedCommands)
            .filter(([_, count]) => count > 1)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([command, count]) => ({ command, count })),
        validation_success: validationSuccess
    };

    try {
        await fs.mkdir(artifactDir, { recursive: true });
        await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');
    } catch (e) {
        console.warn(`⚠️ [Agent] Could not write telemetry artifact: ${e}`);
    }
}

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

async function handleToolCall(workDir: string, block: any, iterTracker: any) {
    const input = block.input as any;
    let result = "";
    const toolStart = Date.now();
    let success = true;

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
                success = false;
        }
    } catch (e: any) {
        result = `Error executing tool: ${e.message}`;
        success = false;
    }

    // Record tool call metrics
    iterTracker.recordToolCall({
        name: block.name,
        path: input.path,
        command: input.command,
        durationMs: Date.now() - toolStart,
        success
    });

    return {
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: result
    };
}

async function runCodingLoop(
    trace: any, 
    systemPrompt: string, 
    workDir: string, 
    plan: string, 
    collector: any
): Promise<string> {
    const execSpan = trace.span({ name: "Coding", model: "claude-sonnet-4-5" });
    const MAX_ITERATIONS = 15;
    let finalOutput = "";
    let messages: any[] = [
        { role: "user", content: `Plan: ${plan}\nWorkspace: ${workDir}\n\nImplement this plan using the available tools.` }
    ];

    try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            const iterTracker = collector.startIteration(i);
            const iterSpan = trace.span({
                name: "LoopIteration",
                metadata: { iteration: i + 1 }
            });

            console.log(`🤖 [Agent] Iteration ${i + 1}/${MAX_ITERATIONS}`);

            const response = await anthropic.messages.create({
                model: "claude-sonnet-4-5",
                max_tokens: 4000,
                system: systemPrompt,
                tools: agentTools as any,
                messages: messages
            });

            messages.push({ role: "assistant", content: response.content });

            const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

            if (toolUseBlocks.length === 0) {
                const textBlock = response.content.find(b => b.type === 'text');
                finalOutput = textBlock ? textBlock.text : "No output";
                console.log("✅ [Agent] Finished execution loop.");
                collector.setFinishReason('NO_TOOL_USE');
                iterSpan.end({ metadata: { tool_calls: 0, finish: true } });
                iterTracker.endIteration();
                break;
            }

            const toolResults = [];
            for (const block of toolUseBlocks) {
                const result = await handleToolCall(workDir, block, iterTracker);
                toolResults.push(result);
            }

            messages.push({ role: "user", content: toolResults });

            iterSpan.end({
                metadata: {
                    tool_calls: toolUseBlocks.length,
                    tool_names: toolUseBlocks.map(b => b.name)
                }
            });
            iterTracker.endIteration();

            if (i === MAX_ITERATIONS - 1) {
                collector.setFinishReason('MAX_ITERATIONS');
                console.warn(`⚠️ [Agent] Reached max iterations (${MAX_ITERATIONS})`);
            }
        }
    } catch (loopError: any) {
        collector.setFinishReason('ERROR');
        throw loopError;
    } finally {
        execSpan.end({
            output: finalOutput,
            metadata: {
                iterations_used: collector.telemetry.totalIterations,
                finish_reason: collector.telemetry.finishReason,
                tool_calls_total: Object.values(collector.telemetry.toolCallsByName).reduce((a: any, b: any) => (a as number) + (b as number), 0),
                tool_calls_by_name: collector.telemetry.toolCallsByName,
                repeated_reads_count: Object.values(collector.telemetry.repeatedReads).filter((c: any) => (c as number) > 1).length,
                repeated_commands_count: Object.values(collector.telemetry.repeatedCommands).filter((c: any) => (c as number) > 1).length
            }
        });
    }
    return finalOutput;
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

            // 2. EXECUTE (Sonnet) - Agentic Loop with Telemetry
            const collector = createTelemetryCollector();
            const finalOutput = await runCodingLoop(trace, systemPrompt, workDir, plan, collector);

            // 3. VALIDATE (Polyglot)
            const valSpan = trace.span({ name: "Validation" });
            const check = await runPolyglotValidation(workDir);
            valSpan.end({ output: check });

            // Write telemetry artifact for debugging and skill optimization
            await writeTelemetryArtifact(workDir, collector.telemetry, check.success);

            // 4. PUSH
            if (check.success) {
                await git.add('.'); await git.commit(`feat: ${task.title}`); await git.push('origin', task.branchName);
            } else {
                await git.add('.'); await git.commit(`wip: ${task.title} (Failed Validation)`); await git.push('origin', task.branchName);
            }
        } finally { cleanup(); }
    });
};
