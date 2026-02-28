import { logger } from './logger';
import { spawn } from 'node:child_process';

export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitError';
    }
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
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
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

            if (stderr.includes('429') || stderr.toLowerCase().includes('rate limit')) {
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

        child.on('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}
