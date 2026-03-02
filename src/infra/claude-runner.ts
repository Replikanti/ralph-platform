import { logger } from './logger';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const activeProcesses = new Set<ChildProcess>();

export function killActiveProcesses(): void {
    for (const child of activeProcesses) {
        logger.info(`🛑 Killing active Claude CLI process PID ${child.pid}`);
        child.kill('SIGTERM');
    }
    activeProcesses.clear();
}

export class RateLimitError extends Error {
    retryAfterMs?: number;
    constructor(message: string, retryAfterMs?: number) {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfterMs = retryAfterMs;
    }
}

export interface ClaudeRunConfig {
    prompt: string;
    model?: string;
    tools?: string;
    timeoutMs?: number;
    allowPermissionBypass?: boolean;
}

export function parseClaudeRateLimit(stderr: string, stdout: string): number | undefined {
    const combinedOutput = stderr + ' ' + stdout;
    
    const retryMatch = /retry.{0,20}?(\d+)\s*second/i.exec(combinedOutput);
    if (retryMatch) {
        return Number.parseInt(retryMatch[1], 10) * 1000;
    }

    const resetMatch = /resets (.*?) \(UTC\)/i.exec(combinedOutput);
    if (resetMatch) {
        const dateStr = resetMatch[1];
        let formattedDate = dateStr.replace(/am/i, ':00 AM').replace(/pm/i, ':00 PM');
        formattedDate = formattedDate.replace(',', `, ${new Date().getUTCFullYear()}`);
        
        const targetTime = Date.parse(`${formattedDate} UTC`);
        if (Number.isNaN(targetTime)) return undefined;

        let delay = targetTime - Date.now();
        if (delay < 0) {
            formattedDate = dateStr.replace(/am/i, ':00 AM').replace(/pm/i, ':00 PM');
            formattedDate = formattedDate.replace(',', `, ${new Date().getUTCFullYear() + 1}`);
            delay = Date.parse(`${formattedDate} UTC`) - Date.now();
        }
        
        return delay > 0 ? delay : undefined;
    }

    return undefined;
}

export function runClaudeExecution(config: ClaudeRunConfig, workDir: string, homeDir: string): Promise<{ stdout: string; stderr: string }> {
    const args: string[] = ['-p', config.prompt];
    if (config.model) args.push('--model', config.model);
    if (config.tools) args.push('--tools', config.tools);
    if (config.allowPermissionBypass) {
        args.push('--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions');
    }
    args.push('--no-session-persistence');
    return runClaude(args, workDir, homeDir, config.timeoutMs ?? 300000);
}

export function runClaude(args: string[], cwd: string, homeDir: string, timeoutMs: number = 300000): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const CLAUDE_PATH = process.env.CLAUDE_BIN_PATH || '/usr/local/bin/claude';

        logger.info("🚀 Spawning: " + CLAUDE_PATH + " in " + cwd);

        const child = spawn(CLAUDE_PATH, args, {
            cwd,
            env: {
                ...process.env,
                HOME: homeDir,
                CI: 'true',
                DEBUG: 'true',
                TERM: 'dumb',
                CLAUDE_CODE_ANALYTICS: 'false'
            }
        });

        if (child.stdin) child.stdin.end();

        if (!child.pid) {
            reject(new Error("Failed to spawn Claude CLI"));
            return;
        }

        activeProcesses.add(child);

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });
        }

        const timeout = setTimeout(() => {
            logger.error("🛑 Timeout after " + timeoutMs + "ms. Killing PID " + child.pid);
            child.kill('SIGKILL');
            reject(new Error("Claude CLI timed out after " + timeoutMs + "ms. Output: " + stdout.substring(stdout.length - 200)));
        }, timeoutMs);

        child.on('close', (code: number) => {
            clearTimeout(timeout);
            activeProcesses.delete(child);

            if (stderr.includes('429') || stderr.toLowerCase().includes('rate limit') || stderr.toLowerCase().includes('hit your limit') || stdout.toLowerCase().includes('hit your limit')) {
                const retryAfterMs = parseClaudeRateLimit(stderr, stdout);
                reject(new RateLimitError("Claude Rate Limit Exceeded", retryAfterMs));
                return;
            }

            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const combined = (stderr + " " + stdout).trim();
                reject(new Error("Claude CLI exited with code " + code + ". Output: " + combined.substring(0, 500)));
            }
        });

        child.on('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}
