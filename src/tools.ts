import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

// --- AGENT TOOLS IMPLEMENTATION ---

export async function listFiles(workDir: string, dirPath: string = "."): Promise<string> {
    const fullPath = path.resolve(workDir, dirPath);
    if (!fullPath.startsWith(workDir)) throw new Error("Access denied");
    
    const entries = await fsPromises.readdir(fullPath, { withFileTypes: true });
    return entries.map((e: fs.Dirent) => e.isDirectory() ? `${e.name}/` : e.name).join("\n");
}

export async function readFile(workDir: string, filePath: string): Promise<string> {
    const fullPath = path.resolve(workDir, filePath);
    if (!fullPath.startsWith(workDir)) throw new Error("Access denied");
    return await fsPromises.readFile(fullPath, "utf-8");
}

export async function writeFile(workDir: string, filePath: string, content: string): Promise<string> {
    const fullPath = path.resolve(workDir, filePath);
    if (!fullPath.startsWith(workDir)) throw new Error("Access denied");
    
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, content, "utf-8");
    return `Wrote to ${filePath}`;
}

// Allowlist of safe command patterns for agent execution
const ALLOWED_COMMAND_PATTERNS = [
    /^npm\s+(test|run|install|ci|build|lint)/,
    /^npx\s+[a-zA-Z0-9@/-]+/,
    /^node\s+[a-zA-Z0-9./_-]+/,
    /^ls\s+(-[a-zA-Z]+\s+)?[a-zA-Z0-9./_-]*$/,
    /^cat\s+[a-zA-Z0-9./_-]+$/,
    /^pwd$/,
    /^echo\s+/,
    /^git\s+(status|log|diff|show)/,
    /^python3?\s+-m\s+pytest/,
    /^pytest/,
    /^ruff\s+/,
    /^mypy\s+/,
];

const DANGEROUS_PATTERNS = [
    /[;&|`$()]/,  // Shell metacharacters
    /rm\s+-rf/,   // Destructive commands
    />\s*\/dev/,  // Device manipulation
    /curl.*\|/,   // Piped downloads
    /wget.*\|/,   // Piped downloads
];

export async function runCommand(workDir: string, command: string): Promise<string> {
    // Security: Validate command against allowlist
    const isAllowed = ALLOWED_COMMAND_PATTERNS.some(pattern => pattern.test(command));
    const isDangerous = DANGEROUS_PATTERNS.some(pattern => pattern.test(command));

    if (!isAllowed || isDangerous) {
        return `ERROR: Command not allowed for security reasons. Only whitelisted commands (npm, git, test tools) are permitted.`;
    }

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: workDir,
            timeout: 60000, // 60s timeout
            maxBuffer: 1024 * 1024 // 1MB max output
        });

        // Sanitize output: limit length and remove potential secrets
        const sanitize = (str: string): string => {
            const maxLen = 5000;
            return str.length > maxLen ? str.substring(0, maxLen) + '\n... (truncated)' : str;
        };

        return `STDOUT:\n${sanitize(stdout)}\n\nSTDERR:\n${sanitize(stderr)}`;
    } catch (e: unknown) {
        const error = e as { stdout?: string, stderr?: string };
        const sanitize = (str: string): string => {
            if (!str) return '';
            const maxLen = 2000;
            return str.length > maxLen ? str.substring(0, maxLen) + '\n... (truncated)' : str;
        };

        return `ERROR: Command failed\n${sanitize(error.stdout || '')}\n${sanitize(error.stderr || '')}`;
    }
}

// --- ANTHROPIC TOOL DEFINITIONS ---

export const agentTools = [
    {
        name: "list_files",
        description: "List files and directories in the workspace.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative path to list (default: .)" }
            }
        }
    },
    {
        name: "read_file",
        description: "Read the content of a file.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative path to the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file (overwrites if exists).",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative path to the file" },
                content: { type: "string", description: "The content to write" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "run_command",
        description: "Run a shell command in the workspace (e.g., npm test, ls -la).",
        input_schema: {
            type: "object",
            properties: {
                command: { type: "string", description: "The shell command to execute" }
            },
            required: ["command"]
        }
    }
];

// --- EXISTING VALIDATION LOGIC ---

// Helper to get changed files
async function getChangedFiles(workDir: string): Promise<string[]> {
    try {
        const { stdout } = await execAsync('git status --porcelain', { cwd: workDir });
        if (!stdout) return [];

        return stdout.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => line.substring(3).trim());
    } catch (e) {
        console.warn("⚠️ Failed to detect changed files:", e);
        return [];
    }
}

// Helper to filter tool output to only include lines relevant to changed files
function filterRelevantErrors(output: string, changedFiles: string[]): { relevant: boolean, filteredLog: string } {
    if (changedFiles.length === 0) return { relevant: false, filteredLog: "" };
    
    const lines = output.split('\n');
    const relevantLines = lines.filter(line => 
        changedFiles.some(file => line.includes(file))
    );

    if (relevantLines.length > 0) {
        return { 
            relevant: true, 
            filteredLog: relevantLines.join('\n') 
        };
    }

    return { relevant: false, filteredLog: "" };
}

// Helper to handle tool errors and filter relevant lines
function handleToolError(error: any, toolName: string, changedFiles: string[]): { success: boolean, log: string, relevant: boolean } {
    const err = error as { stdout?: string, stderr?: string };
    const { relevant, filteredLog } = filterRelevantErrors(err.stdout || err.stderr || "", changedFiles);
    
    if (relevant) {
        return {
            success: false,
            log: `❌ ${toolName} Errors (relevant to your changes):\n${filteredLog}\n`,
            relevant: true
        };
    } else {
        console.log(`ℹ️ [Validation] Ignoring ${toolName} errors unrelated to changed files.`);
        return {
            success: true,
            log: `✅ ${toolName}: Passed (ignored unrelated errors)\n`,
            relevant: false
        };
    }
}

async function validateNode(workDir: string, changedFiles: string[]): Promise<{ success: boolean, log: string }> {
    let outputLog = "";
    let success = true;

    const relevantExtensions = ['.ts', '.js', '.json', '.jsx', '.tsx'];
    const hasRelevantChanges = changedFiles.some((f: string) => 
        relevantExtensions.some(ext => f.endsWith(ext)) || f.includes('package.json')
    );

    if (!hasRelevantChanges) {
        return { success: true, log: "" };
    }

    if (fs.existsSync(path.join(workDir, 'package.json'))) {
        try {
            if (!fs.existsSync(path.join(workDir, 'node_modules'))) {
                console.log("📦 Installing dependencies for validation...");
                await execAsync('npm install --no-package-lock --no-audit --quiet', { cwd: workDir });
            }
            await execAsync('biome check --apply .', { cwd: workDir });
            outputLog += "✅ Biome: Passed\n";
        } catch (e: unknown) { 
            const result = handleToolError(e, "Biome", changedFiles);
            success = success && result.success;
            outputLog += result.log;
        }

        if (fs.existsSync(path.join(workDir, 'tsconfig.json'))) {
             try {
                await execAsync('tsc --noEmit --skipLibCheck', { cwd: workDir });
                outputLog += "✅ TSC: Passed\n";
            } catch (e: unknown) { 
                const result = handleToolError(e, "TSC", changedFiles);
                success = success && result.success;
                outputLog += result.log;
            }
        }
    }
    return { success, log: outputLog };
}

async function validatePython(workDir: string, changedFiles: string[]): Promise<{ success: boolean, log: string }> {
    let outputLog = "";
    let success = true;

    const relevantExtensions = ['.py', '.toml', '.txt'];
    const hasRelevantChanges = changedFiles.some((f: string) => 
        relevantExtensions.some(ext => f.endsWith(ext)) || f.includes('requirements.txt') || f.includes('pyproject.toml')
    );

    if (!hasRelevantChanges) {
        return { success: true, log: "" };
    }

    const hasPython = fs.existsSync(path.join(workDir, 'pyproject.toml')) || 
                      fs.existsSync(path.join(workDir, 'requirements.txt')) ||
                      (await execAsync('find . -maxdepth 2 -name "*.py"', { cwd: workDir }).then(r => r.stdout.length > 0).catch(() => false));

    if (hasPython) {
        try {
            if (fs.existsSync(path.join(workDir, 'requirements.txt'))) {
                console.log("🐍 Installing Python dependencies from requirements.txt...");
                await execAsync('pip install --quiet --no-cache-dir -r requirements.txt', { cwd: workDir });
            } else if (fs.existsSync(path.join(workDir, 'pyproject.toml'))) {
                console.log("🐍 Installing Python dependencies from pyproject.toml...");
                await execAsync('pip install --quiet --no-cache-dir .', { cwd: workDir });
            }
            await execAsync('ruff check --fix .', { cwd: workDir });
            await execAsync('ruff format .', { cwd: workDir });
            outputLog += "✅ Ruff: Passed\n";
        } catch (e: unknown) { 
            const result = handleToolError(e, "Ruff", changedFiles);
            success = success && result.success;
            outputLog += result.log;
        }

        try {
            await execAsync('mypy --ignore-missing-imports .', { cwd: workDir });
            outputLog += "✅ Mypy: Passed\n";
        } catch (e: unknown) { 
            const result = handleToolError(e, "Mypy", changedFiles);
            success = success && result.success;
            outputLog += result.log;
        }
    }
    return { success, log: outputLog };
}

async function validateSecurity(workDir: string, changedFiles: string[]): Promise<{ success: boolean, log: string }> {
    let outputLog = "";
    let success = true;
    const trivyCache = path.join('/tmp', `ralph-trivy-cache-${path.basename(workDir)}`);
    
    try {
        await execAsync(`trivy fs . --cache-dir ${trivyCache} --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --no-progress --exit-code 1`, { cwd: workDir });
        outputLog += "✅ Trivy: Secure\n";
    } catch (e: unknown) { 
        const result = handleToolError(e, "Trivy", changedFiles);
        // Special case for Trivy log message to maintain original wording
        const log = result.relevant 
            ? `❌ Trivy Issues in changed files:\n${result.log.split('\n').slice(1).join('\n')}`
            : "✅ Trivy: Secure (no high/critical issues in changed files)\n";
        
        success = success && result.success;
        outputLog += log;
    } finally {
        try {
            if (fs.existsSync(trivyCache)) {
                await fsPromises.rm(trivyCache, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn("⚠️ Failed to cleanup trivy cache:", e);
        }
    }
    return { success, log: outputLog };
}

export async function runPolyglotValidation(workDir: string): Promise<{ success: boolean, output: string }> {
    let outputLog = "";
    let allSuccess = true;

    const changedFiles = await getChangedFiles(workDir);
    if (changedFiles.length > 0) {
        console.log(`🔍 [Validation] Changed files: ${changedFiles.join(', ')}`);
    } else {
        return { success: true, output: "⏩ Validation skipped: No files changed.\n" };
    }

    const nodeResult = await validateNode(workDir, changedFiles);
    allSuccess = allSuccess && nodeResult.success;
    outputLog += nodeResult.log;

    const pythonResult = await validatePython(workDir, changedFiles);
    allSuccess = allSuccess && pythonResult.success;
    outputLog += pythonResult.log;

    const securityResult = await validateSecurity(workDir, changedFiles);
    allSuccess = allSuccess && securityResult.success;
    outputLog += securityResult.log;

    return { success: allSuccess, output: outputLog };
}