import { Service, Inject } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { spawn } from "node:child_process";
import fsPromises from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setupWorkspace, parseRepoUrl } from "../domain/WorkspaceManager";
import { runPolyglotValidation, detectProjectLanguages } from "../domain/AgentTools";
import { formatPlanForLinear } from "../domain/PlanFormatter";
import { PlanStoreService, StoredPlan } from "./PlanStoreService";
import { LinearClientService } from "./LinearClientService";
import { GitHubService } from "./GitHubService";
import { LangfuseService } from "./LangfuseService";
import {
    ANTHROPIC_API_KEY,
    CLAUDE_BIN_PATH,
    CLAUDE_CACHE_PATH,
    PLAN_REVIEW_ENABLED,
} from "../config/env";

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
    mode?: "full" | "plan-only" | "execute-only";
    existingPlan?: string;
    additionalFeedback?: string;
    isIteration?: boolean;
}

interface IterationContext {
    workDir: string;
    homeDir: string;
    task: Task;
    availableSkills: string;
    git: any;
    trace: any;
}

export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RateLimitError";
    }
}

@Service()
export class AgentOrchestratorService {
    private logger = new Logger("AgentOrchestrator");
    private readonly SECURITY_GUARDRAILS = "SECURITY RULES: 1. NO SECRETS. 2. SANDBOX: Only modify files inside the workspace.";
    private readonly CLAUDE_CACHE_ROOT: string;

    @Inject() private planStore!: PlanStoreService;
    @Inject() private linear!: LinearClientService;
    @Inject() private github!: GitHubService;
    @Inject() private langfuse!: LangfuseService;

    constructor() {
        this.CLAUDE_CACHE_ROOT = CLAUDE_CACHE_PATH;
        if (!fs.existsSync(this.CLAUDE_CACHE_ROOT)) {
            try {
                fs.mkdirSync(this.CLAUDE_CACHE_ROOT, { recursive: true });
            } catch (e: any) {
                this.logger.warn("Could not create cache root: " + e.message);
            }
        }
    }

    // --- MAIN ENTRY POINT ---

    async runAgent(task: Task): Promise<void> {
        const mode = task.mode || "full";
        const planReviewEnabled = PLAN_REVIEW_ENABLED;
        const actualMode = mode === "full" && planReviewEnabled ? "plan-only" : mode;

        this.logger.info(`Running agent in mode: ${actualMode}`);

        // Setup workspace first to detect languages
        const { workDir, rootDir, git, cleanup } = await setupWorkspace(task.repoUrl, task.branchName);

        // Detect project languages for Langfuse tracking
        const detectedLanguages = await detectProjectLanguages(workDir);

        return this.langfuse.withTrace(
            "Ralph-Task",
            {
                ticketId: task.ticketId,
                mode: actualMode,
                languages: detectedLanguages,
                repository: task.repoUrl,
                taskType: this.detectTaskType(task.title),
            },
            async (trace: any) => {
                const homeDir = path.join(rootDir, "home");
                const targetClaudeDir = path.join(homeDir, ".claude");

                try {
                    const availableSkills = await this.setupClaudeEnvironment(targetClaudeDir, workDir, homeDir);

                    if (actualMode === "plan-only") {
                        await this.handlePlanOnlyMode(task, workDir, homeDir, trace, availableSkills);
                        return;
                    }

                    if (actualMode === "execute-only") {
                        if (!task.existingPlan) {
                            throw new Error("execute-only mode requires existingPlan");
                        }
                        await this.handleExecuteOnlyMode(task, workDir, homeDir, git, trace, task.existingPlan);
                        return;
                    }

                    await this.runFullMode(task, workDir, homeDir, git, trace, availableSkills, targetClaudeDir);
                } finally {
                    cleanup();
                }
            }
        );
    }

    // --- MODE HANDLERS ---

    private async handlePlanOnlyMode(
        task: Task,
        workDir: string,
        homeDir: string,
        trace: any,
        availableSkills: string
    ): Promise<void> {
        if (task.isIteration) {
            this.logger.info("Running plan-only mode for PR iteration");

            // For iterations, issue is already in "In Review" - move back to In Progress
            await this.linear.updateIssueState(task.ticketId, "In Progress");
            await this.linear.postComment(
                task.ticketId,
                `🔄 Ralph is creating iteration plan based on your feedback...\n\n📋 **Job ID:** \`${task.jobId}\``
            );
        } else {
            this.logger.info("Running plan-only mode");

            // Move ticket to In Progress state when Ralph starts working
            await this.linear.updateIssueState(task.ticketId, "In Progress");
            await this.linear.postComment(
                task.ticketId,
                `🤖 Ralph is generating implementation plan...\n\n📋 **Job ID:** \`${task.jobId}\``
            );
        }

        // Generate plan with Opus
        const planSpan = trace.span({ name: "Planning-Opus-Plan-Review", metadata: { mode: "plan-only" } });
        const previousErrors = task.additionalFeedback || "";
        const rawPlan = await this.planPhase(workDir, homeDir, task, availableSkills, previousErrors);
        const plan = rawPlan.replaceAll("<plan>", "").replaceAll("</plan>", "").trim();
        planSpan.end({ output: plan });

        // Store plan in Redis
        const storedPlan: StoredPlan = {
            taskId: task.ticketId,
            plan,
            taskContext: {
                ticketId: task.ticketId,
                title: task.title,
                description: task.description,
                repoUrl: task.repoUrl,
                branchName: task.branchName,
                isIteration: task.isIteration,
            },
            feedbackHistory: task.additionalFeedback ? [task.additionalFeedback] : [],
            createdAt: new Date(),
            status: "pending-review",
        };
        await this.planStore.storePlan(task.ticketId, storedPlan);

        // Format and post plan to Linear
        const formattedPlan = formatPlanForLinear(plan, task.title);
        await this.linear.postComment(task.ticketId, formattedPlan);

        // Move ticket to Todo state - signals plan is ready for human review
        await this.linear.updateIssueState(task.ticketId, "Todo");
        this.logger.info("Plan posted to Linear, awaiting human approval");
    }

    private async handleExecuteOnlyMode(
        task: Task,
        workDir: string,
        homeDir: string,
        git: any,
        trace: any,
        plan: string
    ): Promise<void> {
        this.logger.info("Running execute-only mode with approved plan");

        await this.linear.updateIssueWithComment(
            task.ticketId,
            "In Progress",
            `🤖 Ralph is executing approved plan...\n\n📋 **Job ID:** \`${task.jobId}\``
        );

        // Execute the plan with Sonnet
        const execSpan = trace.span({ name: "Execution-Sonnet-Approved-Plan", metadata: { mode: "execute-only" } });
        await this.executePhase(workDir, homeDir, plan);
        execSpan.end();

        // Run validation
        const check = await runPolyglotValidation(workDir);

        if (check.success) {
            this.logger.info("Validation passed!");
            await this.handleValidationSuccess(task, workDir, git, check);
        } else {
            await this.handleValidationFailure(task, check.output);
        }
    }

    private async runFullMode(
        task: Task,
        workDir: string,
        homeDir: string,
        git: any,
        trace: any,
        availableSkills: string,
        targetClaudeDir: string
    ): Promise<void> {
        await this.linear.updateIssueWithComment(
            task.ticketId,
            "In Progress",
            `🤖 Ralph started working\n\n📋 **Job ID:** \`${task.jobId}\``
        );

        let previousErrors = "";
        for (let i = 0; i < 3; i++) {
            const result = await this.runIteration(
                i + 1,
                { trace, workDir, homeDir, task, availableSkills, git },
                previousErrors
            );
            await this.persistClaudeCache(targetClaudeDir);
            if (result.success) {
                return;
            }
            previousErrors = result.output || "Unknown error";
        }
        await this.handleFailureFallback(workDir, homeDir, task, git, previousErrors, 3);
    }

    // --- VALIDATION HANDLERS ---

    private async handleValidationSuccess(
        task: Task,
        workDir: string,
        git: any,
        validationResult: { success: boolean; output: string }
    ): Promise<void> {
        await git.add(".");
        const status = await git.status();

        if (status.staged.length > 0) {
            await git.commit("feat: " + task.title);

            // For iterations, don't force push (preserve PR history)
            // For new work, force push to ensure clean history
            const pushArgs = task.isIteration ? [] : ["--force"];
            await git.push("origin", task.branchName, pushArgs);

            // Only create PR if this is not an iteration (PR already exists)
            if (task.isIteration) {
                await this.handleIterationCompletion(task);
            } else {
                await this.handlePRCreationAndStateUpdate(task, workDir, git, validationResult);
            }
        } else {
            this.logger.warn("No files changed.");
            await this.linear.updateIssueWithComment(task.ticketId, "Todo", "⚠️ No changes necessary.");
        }

        // Clean up stored plan (but keep it for iterations to allow further fixes)
        if (!task.isIteration) {
            await this.planStore.deletePlan(task.ticketId);
        }
    }

    private async handleValidationFailure(task: Task, validationOutput: string): Promise<void> {
        this.logger.warn("Validation failed after execution:\n" + validationOutput);
        await this.linear.updateIssueWithComment(
            task.ticketId,
            "Todo",
            "❌ Execution completed but validation failed.\n\n```\n" + validationOutput.substring(0, 1000) + "\n```"
        );
    }

    private async handleIterationCompletion(task: Task): Promise<void> {
        await this.linear.updateIssueWithComment(
            task.ticketId,
            "In Review",
            "✅ Iteration complete. Changes pushed to existing PR."
        );
    }

    private async handlePRCreationAndStateUpdate(
        task: Task,
        workDir: string,
        git: any,
        validationResult: { success: boolean; output: string }
    ): Promise<void> {
        // Generate rich PR description with stats and validation results
        const prBody = await this.github.generatePRDescription(git, task.description || "", validationResult);

        // Create PR first, then wait for Linear auto-switch
        const prUrl = await this.github.createPullRequest(task.repoUrl, task.branchName, "feat: " + task.title, prBody);
        this.logger.info("Waiting 3 seconds for Linear auto-switch to In Review...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Check if Linear auto-switched, only update if needed
        const currentState = await this.linear.getIssueState(task.ticketId);
        if (currentState?.toLowerCase() === "in review") {
            this.logger.info("Linear auto-switched to In Review, just adding comment");
            await this.linear.postComment(task.ticketId, "✅ Done. PR: " + prUrl);
        } else {
            this.logger.info(`Linear didn't auto-switch (current: ${currentState}), manually updating to In Review`);
            await this.linear.updateIssueWithComment(task.ticketId, "In Review", "✅ Done. PR: " + prUrl);
        }
    }

    // --- ITERATION & FAILURE HANDLING ---

    private async runIteration(
        iteration: number,
        ctx: IterationContext,
        previousErrors: string
    ): Promise<{ success: boolean; output?: string }> {
        this.logger.info(`Iteration ${iteration}`);

        const planSpan = ctx.trace.span({ name: "Planning-Opus-Iter-" + iteration, metadata: { iteration } });
        const rawPlan = await this.planPhase(ctx.workDir, ctx.homeDir, ctx.task, ctx.availableSkills, previousErrors);
        const plan = rawPlan.replaceAll("<plan>", "").replaceAll("</plan>", "").trim();
        planSpan.end({ output: plan });

        const execSpan = ctx.trace.span({ name: "Execution-Sonnet-Iter-" + iteration, metadata: { iteration } });
        await this.executePhase(ctx.workDir, ctx.homeDir, plan);
        execSpan.end();

        // Validation span with rich metadata for Langfuse
        const validationSpan = ctx.trace.span({
            name: "Validation",
            metadata: { iteration },
        });

        const check = await runPolyglotValidation(ctx.workDir);

        validationSpan.end({
            output: check.output,
            metadata: {
                success: check.success,
                languages: check.languages,
                toolResults: check.toolResults,
                totalErrors: check.totalErrors,
                relevantErrors: check.relevantErrors,
            },
        });

        if (check.success) {
            this.logger.info("Validation passed!");
            await ctx.git.add(".");
            const status = await ctx.git.status();
            if (status.staged.length > 0) {
                await ctx.git.commit("feat: " + ctx.task.title);
                await ctx.git.push("origin", ctx.task.branchName, ["--force"]);

                // Generate rich PR description with stats and validation results
                const prBody = await this.github.generatePRDescription(ctx.git, ctx.task.description || "", check);

                // Create PR first, then wait for Linear auto-switch
                const prUrl = await this.github.createPullRequest(
                    ctx.task.repoUrl,
                    ctx.task.branchName,
                    "feat: " + ctx.task.title,
                    prBody
                );
                this.logger.info("Waiting 3 seconds for Linear auto-switch to In Review...");
                await new Promise((resolve) => setTimeout(resolve, 3000));

                // Check if Linear auto-switched, only update if needed
                const currentState = await this.linear.getIssueState(ctx.task.ticketId);
                if (currentState?.toLowerCase() === "in review") {
                    this.logger.info("Linear auto-switched to In Review, just adding comment");
                    await this.linear.postComment(ctx.task.ticketId, "✅ Done. PR: " + prUrl);
                } else {
                    this.logger.info(
                        `Linear didn't auto-switch (current: ${currentState}), manually updating to In Review`
                    );
                    await this.linear.updateIssueWithComment(ctx.task.ticketId, "In Review", "✅ Done. PR: " + prUrl);
                }
            } else {
                this.logger.warn("No files changed.");
                await this.linear.updateIssueWithComment(ctx.task.ticketId, "Todo", "⚠️ No changes necessary.");
            }
            return { success: true };
        }
        this.logger.warn("Validation failed (Iter " + iteration + "):\n" + check.output);
        return { success: false, output: check.output };
    }

    private async handleFailureFallback(
        workDir: string,
        homeDir: string,
        task: Task,
        git: any,
        previousErrors: string,
        MAX_RETRIES: number
    ): Promise<void> {
        this.logger.warn("Task failed after " + MAX_RETRIES + " attempts.");
        const explanation = await this.summarizeFailurePhase(task, homeDir, previousErrors);
        const failComment =
            "❌ Failed after " +
            MAX_RETRIES +
            " attempts.\n\n" +
            explanation +
            "\n\n---\nDetails:\n```\n" +
            previousErrors.substring(0, 1000) +
            "...\n```";
        await this.linear.updateIssueWithComment(task.ticketId, "Todo", failComment);
    }

    // --- CORE AGENT PHASES ---

    private async planPhase(
        workDir: string,
        homeDir: string,
        task: Task,
        availableSkills: string,
        previousErrors?: string
    ): Promise<string> {
        let guide = "";
        try {
            guide = await fsPromises.readFile(path.join(workDir, "CLAUDE.md"), "utf-8");
        } catch {
            guide = "None.";
        }

        const iterationContext = task.isIteration
            ? "\n\n⚠️ ITERATION MODE: This is a fix/improvement for an existing PR." +
              "\n- A PR already exists on branch: " +
              task.branchName +
              "\n- You will be working on the existing code/branch" +
              "\n- Focus on addressing the specific feedback provided" +
              "\n- Review recent changes with git log/diff before planning"
            : "";

        const prompt =
            "You are the Architect. Create a step-by-step implementation plan for the task.\n\n" +
            "PROJECT GUIDE:\n" +
            guide +
            "\n\n" +
            "TASK: " +
            task.title +
            "\n" +
            "DESCRIPTION: " +
            task.description +
            "\n" +
            "AVAILABLE SLASH COMMANDS: " +
            availableSkills +
            "\n" +
            (previousErrors ? "\nPREVIOUS ATTEMPT ERRORS:\n" + previousErrors : "") +
            iterationContext +
            "\n\n" +
            "GOALS:\n1. Detailed plan.\n2. Mention slash commands to use.\n3. Address only the task.\n\n" +
            "Output your plan inside <plan> tags.";

        // Switch to Sonnet 4.5 and add budget limit
        const { stdout } = await this.runClaude(
            ["-p", prompt, "--model", "claude-sonnet-4-5-20250929", "--tools", "", "--max-budget-usd", "0.50", "--no-session-persistence"],
            workDir,
            homeDir
        );
        const match = /<plan>([\s\S]*?)<\/plan>/.exec(stdout);
        return match ? match[1].trim() : "No plan tags found.";
    }

    private async executePhase(workDir: string, homeDir: string, plan: string): Promise<any> {
        const prompt =
            "You are the Executor. Implement this plan strictly: " +
            plan +
            "\n" +
            "RULES: No secrets, stay in sandbox, only necessary files, do not commit.";
        return await this.runClaude(
            [
                "-p",
                prompt,
                "--model",
                "sonnet",
                "--tools",
                "Bash,Read,Edit,FileSearch,Glob",
                "--dangerously-skip-permissions",
                "--permission-mode",
                "bypassPermissions",
                "--max-budget-usd",
                "2.00",
                "--no-session-persistence",
            ],
            workDir,
            homeDir,
            900000
        );
    }

    // --- CLAUDE CLI EXECUTION ---

    private runClaude(
        args: string[],
        cwd: string,
        homeDir: string,
        timeoutMs: number = 300000
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const CLAUDE_PATH = CLAUDE_BIN_PATH;

            this.logger.info("Spawning: " + CLAUDE_PATH + " in " + cwd);

            const child = spawn(CLAUDE_PATH, args, {
                cwd,
                env: {
                    ...process.env,
                    HOME: homeDir,
                    ANTHROPIC_API_KEY: ANTHROPIC_API_KEY,
                    CI: "true",
                    DEBUG: "true",
                    TERM: "dumb",
                    CLAUDE_CODE_ANALYTICS: "false",
                },
            });

            if (child.stdin) child.stdin.end();

            if (!child.pid) {
                reject(new Error("Failed to spawn Claude CLI"));
                return;
            }

            let stdout = "";
            let stderr = "";

            if (child.stdout) {
                child.stdout.on("data", (data: Buffer) => {
                    const str = data.toString();
                    stdout += str;
                    process.stdout.write(str);
                });
            }

            if (child.stderr) {
                child.stderr.on("data", (data: Buffer) => {
                    const str = data.toString();
                    stderr += str;
                    process.stderr.write(str);
                });
            }

            const timeout = setTimeout(() => {
                this.logger.error("Timeout after " + timeoutMs + "ms. Killing PID " + child.pid);
                child.kill("SIGKILL");
                reject(
                    new Error("Claude CLI timed out after " + timeoutMs + "ms. Output: " + stdout.substring(stdout.length - 200))
                );
            }, timeoutMs);

            child.on("close", (code: number) => {
                clearTimeout(timeout);

                // Detect Rate Limits in stderr
                if (stderr.includes("429") || stderr.toLowerCase().includes("rate limit")) {
                    reject(new RateLimitError("Anthropic Rate Limit Exceeded"));
                    return;
                }

                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    const combined = (stderr + " " + stdout).trim();
                    reject(new Error("Claude CLI exited with code " + code + ". Output: " + combined.substring(0, 500)));
                }
            });

            child.on("error", (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    // --- FAILURE SUMMARIZATION ---

    private async summarizeFailurePhase(task: Task, homeDir: string, errors: string): Promise<string> {
        const prompt =
            "You are the Post-Mortem Analyst. Ralph failed a task. " +
            "TASK: " +
            task.title +
            " ERRORS: " +
            errors.substring(0, 2000) +
            " Explain why it failed in 2 sentences.";
        try {
            // Use Haiku 4.5 for summary to save money
            const { stdout } = await this.runClaude(
                ["-p", prompt, "--model", "claude-haiku-4-5-20251001", "--tools", "", "--max-budget-usd", "0.10"],
                process.cwd(),
                homeDir
            );
            return stdout.trim();
        } catch {
            return "Task failed due to persistent validation errors.";
        }
    }

    // --- CLAUDE ENVIRONMENT SETUP ---

    private async setupClaudeEnvironment(targetClaudeDir: string, workDir: string, homeDir: string): Promise<string> {
        await fsPromises.mkdir(targetClaudeDir, { recursive: true });
        const sourceClaudeDir = path.join(os.homedir(), ".claude");

        try {
            await this.copyClaudeCredentials(sourceClaudeDir, targetClaudeDir);
            await this.configureClaudeSettings(targetClaudeDir);
            await this.ensureClaudeCredentialsExist(targetClaudeDir);
        } catch (e: any) {
            this.logger.warn("Seed failed: " + e.message);
        }

        await this.seedClaudeCache(targetClaudeDir);
        await this.prepareClaudeSkills(workDir, homeDir);
        return await this.listAvailableSkills(workDir);
    }

    private async copyClaudeCredentials(sourceDir: string, targetDir: string): Promise<void> {
        const files = [".credentials.json", "settings.json"];
        for (const f of files) {
            const src = path.join(sourceDir, f);
            const dst = path.join(targetDir, f);
            if (fs.existsSync(src)) {
                await fsPromises.copyFile(src, dst);
            }
        }
    }

    private async configureClaudeSettings(targetClaudeDir: string): Promise<void> {
        const settingsFile = path.join(targetClaudeDir, "settings.json");
        let settings: any = {};

        if (fs.existsSync(settingsFile)) {
            try {
                settings = JSON.parse(await fsPromises.readFile(settingsFile, "utf-8"));
            } catch {
                settings = {};
            }
        }

        if (!settings.mcpServers) {
            settings.mcpServers = {};
        }

        settings.mcpServers.toonify = {
            command: "node",
            args: ["/app/dist/mcp-toonify.js"],
        };

        await fsPromises.writeFile(settingsFile, JSON.stringify(settings, null, 2));

        const toonifyConfig = path.join(targetClaudeDir, "toonify-config.json");
        if (!fs.existsSync(toonifyConfig)) {
            await fsPromises.writeFile(
                toonifyConfig,
                JSON.stringify(
                    {
                        enabled: true,
                        minTokensThreshold: 50,
                        minSavingsThreshold: 30,
                        skipToolPatterns: ["Bash", "Write", "Edit"],
                    },
                    null,
                    2
                )
            );
        }
    }

    private async ensureClaudeCredentialsExist(targetClaudeDir: string): Promise<void> {
        const credsFile = path.join(targetClaudeDir, ".credentials.json");
        if (!fs.existsSync(credsFile)) {
            await fsPromises.writeFile(credsFile, JSON.stringify({ token: "dummy", email: "ralph@duvo.ai" }));
        }
    }

    private async listAvailableSkills(workDir: string): Promise<string> {
        const skillsDir = path.join(workDir, ".claude", "commands");
        try {
            const dirs = await fsPromises.readdir(skillsDir, { withFileTypes: true });
            return dirs
                .filter((d: fs.Dirent) => d.isDirectory())
                .map((d: fs.Dirent) => `- /${d.name}`)
                .join("\n");
        } catch {
            return "No native commands available.";
        }
    }

    private async prepareClaudeSkills(workDir: string, homeDir: string): Promise<void> {
        const targetSkillsDir = path.join(homeDir, ".claude", "commands");
        const sourceSkillsDir = path.join(workDir, ".claude", "commands");
        const targetScriptsDir = path.join(homeDir, ".claude", "scripts");
        const sourceScriptsDir = path.join(workDir, ".claude", "scripts");

        try {
            if (await fsPromises.stat(sourceSkillsDir).then(() => true, () => false)) {
                await fsPromises.mkdir(targetSkillsDir, { recursive: true });
                await fsPromises.cp(sourceSkillsDir, targetSkillsDir, { recursive: true });
            }

            if (await fsPromises.stat(sourceScriptsDir).then(() => true, () => false)) {
                await fsPromises.mkdir(targetScriptsDir, { recursive: true });
                await fsPromises.cp(sourceScriptsDir, targetScriptsDir, { recursive: true });
            }

            this.logger.info("Loaded commands into isolated Claude environment");
        } catch (e: any) {
            this.logger.warn("Failed to load commands: " + e.message);
        }
    }

    // --- CACHE MANAGEMENT ---

    private async syncDirectoryContents(sourceDir: string, targetDir: string, operation: string): Promise<void> {
        if (!fs.existsSync(sourceDir)) return;

        await fsPromises.mkdir(targetDir, { recursive: true });
        const { execSync } = await import("node:child_process");
        try {
            execSync("cp -r " + sourceDir + "/* " + targetDir + "/");
            this.logger.info(operation + " Claude projects cache");
        } catch (e: any) {
            this.logger.warn(operation + " failed: " + e.message);
        }
    }

    private async seedClaudeCache(targetClaudeDir: string): Promise<void> {
        const projectsCache = path.join(this.CLAUDE_CACHE_ROOT, "projects");
        const targetProjects = path.join(targetClaudeDir, "projects");
        await this.syncDirectoryContents(projectsCache, targetProjects, "Seeded");
    }

    private async persistClaudeCache(sourceClaudeDir: string): Promise<void> {
        const projectsSource = path.join(sourceClaudeDir, "projects");
        const targetProjects = path.join(this.CLAUDE_CACHE_ROOT, "projects");
        await this.syncDirectoryContents(projectsSource, targetProjects, "Persisted");
    }

    // --- HELPERS ---

    private detectTaskType(title: string): string {
        const lower = title.toLowerCase();
        if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
        if (lower.includes("refactor")) return "refactor";
        if (lower.includes("test")) return "test";
        if (lower.includes("doc")) return "docs";
        return "feature";
    }
}
