/**
 * BAML Proxy — OpenAI-compatible HTTP server (default port 3001)
 *
 * BAML thinks it's talking to an OpenAI-compatible endpoint. This proxy
 * translates those requests into runClaude() calls so we keep the flat-rate
 * Claude Max subscription for planning and summarization phases.
 *
 * Architecture:
 *   BAML (openai-generic → localhost:3001) → baml-proxy.ts → runClaude() → Claude CLI
 */

import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { logger } from './logger';
import { runClaude, RateLimitError } from './claude-runner';

interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface ChatCompletionRequest {
    model: string;
    messages: OpenAIMessage[];
    stream?: boolean;
}

function buildPromptFromMessages(messages: OpenAIMessage[]): string {
    return messages
        .map(m => {
            if (m.role === 'system') return `[System]: ${m.content}`;
            if (m.role === 'user') return m.content;
            return `[Assistant]: ${m.content}`;
        })
        .join('\n\n');
}

function openAiResponse(model: string, content: string) {
    return {
        id: `chatcmpl-baml-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}

async function setupTempHome(): Promise<{ homeDir: string; cleanup: () => Promise<void> }> {
    const homeDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'baml-proxy-'));
    const claudeDir = path.join(homeDir, '.claude');
    await fsPromises.mkdir(claudeDir, { recursive: true });

    const systemClaudeDir = path.join(os.homedir(), '.claude');
    for (const f of ['.credentials.json', 'settings.json']) {
        const src = path.join(systemClaudeDir, f);
        if (fs.existsSync(src)) {
            try { await fsPromises.copyFile(src, path.join(claudeDir, f)); } catch { /* ignore */ }
        }
    }

    return {
        homeDir,
        cleanup: () => fsPromises.rm(homeDir, { recursive: true, force: true }),
    };
}

export async function startBamlProxy(port = 3001): Promise<void> {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '4mb' }));

    app.get('/v1/models', (_req, res) => {
        res.json({
            object: 'list',
            data: [
                { id: 'claude-sonnet-4-5-20250929', object: 'model' },
                { id: 'claude-haiku-4-5-20251001', object: 'model' },
            ],
        });
    });

    app.post('/v1/chat/completions', async (req, res) => {
        const body = req.body as ChatCompletionRequest;
        const model = body.model ?? 'claude-sonnet-4-5-20250929';
        const prompt = buildPromptFromMessages(body.messages ?? []);

        const { homeDir, cleanup } = await setupTempHome();
        try {
            const { stdout } = await runClaude(
                ['-p', prompt, '--model', model, '--tools', '', '--no-session-persistence'],
                process.cwd(),
                homeDir,
            );
            res.json(openAiResponse(model, stdout.trim()));
        } catch (err: any) {
            if (err instanceof RateLimitError) {
                res.status(429).json({ error: { type: 'rate_limit_error', message: err.message } });
            } else {
                logger.error({ err }, 'BAML proxy error');
                res.status(500).json({ error: { type: 'server_error', message: err.message } });
            }
        } finally {
            await cleanup();
        }
    });

    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            logger.info(`🔌 BAML proxy listening on port ${port}`);
            resolve();
        });
        server.on('error', reject);
    });
}
