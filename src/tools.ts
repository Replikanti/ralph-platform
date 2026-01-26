import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

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
                      (await execAsync('find . -maxdepth 2 -name "*.py"', { cwd: workDir }).then(r => r.stdout.length > 0).catch(() => false));

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

    // 3. Security: Semgrep (Universal)
    try {
        await execAsync('semgrep scan --config auto --error .', { cwd: workDir });
        outputLog += "✅ Semgrep: Secure\n";
    } catch (e: any) { allSuccess = false; outputLog += `❌ Semgrep Issues Found\n`; }

    return { success: allSuccess, output: outputLog };
}
