import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

export async function runPolyglotValidation(workDir: string) {
    let outputLog = "";
    let allSuccess = true;

    // 1. TS/JS: Biome
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
        try {
            await execAsync('biome check --apply .', { cwd: workDir });
            outputLog += "✅ Biome: Passed\n";
        } catch (e: any) { allSuccess = false; outputLog += `❌ Biome: ${e.stdout}\n`; }
    }

    // 2. Python: Ruff
    if (fs.existsSync(path.join(workDir, 'pyproject.toml'))) {
        try {
            await execAsync('ruff check --fix .', { cwd: workDir });
            await execAsync('ruff format .', { cwd: workDir });
            outputLog += "✅ Ruff: Passed\n";
        } catch (e: any) { allSuccess = false; outputLog += `❌ Ruff: ${e.stdout}\n`; }
    }

    // 3. Security: Semgrep (Universal)
    try {
        await execAsync('semgrep scan --config auto --error .', { cwd: workDir });
        outputLog += "✅ Semgrep: Secure\n";
    } catch (e: any) { allSuccess = false; outputLog += `❌ Semgrep Issues Found\n`; }

    return { success: allSuccess, output: outputLog };
}
