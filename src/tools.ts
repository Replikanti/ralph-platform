import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

// --- AGENT TOOLS IMPLEMENTATION ---

export async function listFiles(workDir: string, dirPath: string = ".") {
    const fullPath = path.resolve(workDir, dirPath);
    if (!fullPath.startsWith(workDir)) throw new Error("Access denied");
    
    const entries = await fsPromises.readdir(fullPath, { withFileTypes: true });
    return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join("\n");
}

export async function readFile(workDir: string, filePath: string) {
    const fullPath = path.resolve(workDir, filePath);
    if (!fullPath.startsWith(workDir)) throw new Error("Access denied");
    return await fsPromises.readFile(fullPath, "utf-8");
}

export async function writeFile(workDir: string, filePath: string, content: string) {
    const fullPath = path.resolve(workDir, filePath);
    if (!fullPath.startsWith(workDir)) throw new Error("Access denied");
    
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, content, "utf-8");
    return `Wrote to ${filePath}`;
}

export async function runCommand(workDir: string, command: string) {
    // Basic security: prevent breaking out of execution context? 
    // In Docker container, it's safer, but still good to be careful.
    try {
        const { stdout, stderr } = await execAsync(command, { cwd: workDir });
        return `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
    } catch (e: any) {
        return `ERROR:\n${e.message}\nSTDOUT:\n${e.stdout}\nSTDERR:\n${e.stderr}`;
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

export async function runPolyglotValidation(workDir: string) {
    let outputLog = "";
    let allSuccess = true;

    // 1. TS/JS: Biome & TSC
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
        try {
            await execAsync('biome check --apply .', { cwd: workDir });
            outputLog += "✅ Biome: Passed\n";
        } catch (e: any) { allSuccess = false; outputLog += `❌ Biome: ${e.stdout}\n`; }

        if (fs.existsSync(path.join(workDir, 'tsconfig.json'))) {
             try {
                await execAsync('tsc --noEmit', { cwd: workDir });
                outputLog += "✅ TSC: Passed\n";
            } catch (e: any) { allSuccess = false; outputLog += `❌ TSC: ${e.stdout}\n`; }
        }
    }

    // 2. Python: Ruff & Mypy
    const hasPython = fs.existsSync(path.join(workDir, 'pyproject.toml')) || 
                      fs.existsSync(path.join(workDir, 'requirements.txt')) ||
                      (await execAsync('find . -maxdepth 2 -name "*.py"', { cwd: workDir }).then(r => r.stdout.length > 0).catch(() => false /* Ignore find errors */));

    if (hasPython) {
        try {
            await execAsync('ruff check --fix .', { cwd: workDir });
            await execAsync('ruff format .', { cwd: workDir });
            outputLog += "✅ Ruff: Passed\n";
        } catch (e: any) { allSuccess = false; outputLog += `❌ Ruff: ${e.stdout}\n`; }

        try {
            // --ignore-missing-imports is safer for environments without all stubs installed
            await execAsync('mypy --ignore-missing-imports .', { cwd: workDir });
            outputLog += "✅ Mypy: Passed\n";
        } catch (e: any) { allSuccess = false; outputLog += `❌ Mypy: ${e.stdout}\n`; }
    }

    // 3. Security: Trivy (Universal - Apache 2.0)
    // Scans for vulnerabilities, secrets, and misconfigurations
    try {
        await execAsync('trivy fs . --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --no-progress --exit-code 1', { cwd: workDir });
        outputLog += "✅ Trivy: Secure\n";
    } catch (e: any) { 
        allSuccess = false; 
        outputLog += `❌ Trivy Issues Found:\n${e.stdout || e.stderr}\n`; 
    }

    return { success: allSuccess, output: outputLog };
}
