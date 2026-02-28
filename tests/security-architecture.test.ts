/**
 * Security Architecture Invariant Tests
 *
 * These tests enforce structural rules that guarantee the PII/secret redaction
 * architecture is not accidentally broken by future changes.  They run against
 * the source files directly (no runtime, no mocks) and complete in < 100 ms.
 *
 * Rules being enforced:
 *   1. agent.ts must NOT import security/redactor  (redaction = platform concern)
 *   2. baml-proxy.ts must call redactText() BEFORE runClaude() in the POST handler
 *   3. redactor.ts must be fail-closed (throws on error, never returns original text)
 *   4. server.ts must redact title and description BEFORE ralphQueue.add()
 *   5. worker.ts must redact validationOutput BEFORE posting the fail comment to Linear
 */

import { describe, it, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';

// ── helpers ──────────────────────────────────────────────────────────────────

async function src(relPath: string): Promise<string> {
    return readFile(relPath, 'utf-8');
}

/** Returns the character index of the LAST occurrence of needle before limit. */
function lastIndexBefore(haystack: string, needle: string, limit: number): number {
    const idx = haystack.lastIndexOf(needle, limit);
    return idx;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Security architecture invariants', () => {
    it('agent.ts has no dependency on security/redactor (redaction is platform-only)', async () => {
        const code = await src('src/agent/agent.ts');
        expect(code).not.toMatch(/security\/redactor/);
    });

    it('baml-proxy.ts calls redactText() before runClaude() in the POST handler', async () => {
        const code = await src('src/infra/baml-proxy.ts');
        const handlerStart = code.indexOf("app.post('/v1/chat/completions'");
        expect(handlerStart).toBeGreaterThan(-1);

        const redactIdx  = code.indexOf('redactText(',  handlerStart);
        const claudeIdx  = code.indexOf('runClaude(',   handlerStart);

        expect(redactIdx).toBeGreaterThan(-1);
        expect(claudeIdx).toBeGreaterThan(-1);
        expect(redactIdx).toBeLessThan(claudeIdx);
    });

    it('redactor.ts is fail-closed: catch block throws instead of returning original text', async () => {
        const code = await src('src/security/redactor.ts');
        const catchIdx   = code.lastIndexOf('} catch');
        const catchBlock = code.slice(catchIdx);
        expect(catchBlock).toMatch(/throw new Error/);
        expect(catchBlock).not.toMatch(/return text/);
    });

    it('server.ts redacts issue.title and issue.description before enqueueing', async () => {
        const code = await src('src/platform/server.ts');

        // The issue webhook handler inlines the object directly (vs enqueueJob helper
        // which passes a jobData variable). Match the inline form to find the right call.
        const queueAddIdx = code.indexOf("ralphQueue.add('coding-task', {");
        expect(queueAddIdx).toBeGreaterThan(-1);

        // safeTitle (= redactText(issue.title)) must be assigned BEFORE the add() call
        const safeTitleIdx = lastIndexBefore(code, 'const safeTitle', queueAddIdx);
        expect(safeTitleIdx).toBeGreaterThan(-1);

        // issue.description must be wrapped in redactText inside the add() payload.
        // It is inline in the object literal, so it appears after queueAddIdx.
        const descRedactIdx = code.indexOf('redactText(issue.description', queueAddIdx);
        expect(descRedactIdx).toBeGreaterThan(-1);

        // Sanity: the description redact must be within the same add() block (< 500 chars away)
        expect(descRedactIdx - queueAddIdx).toBeLessThan(500);
    });

    it('worker.ts redacts validationOutput before posting the fail comment to Linear', async () => {
        const code = await src('src/platform/worker.ts');
        const failCommentIdx = code.indexOf('const failComment');
        expect(failCommentIdx).toBeGreaterThan(-1);

        // redactText must be called before failComment is constructed
        const redactIdx = lastIndexBefore(code, 'redactText(action.validationOutput', failCommentIdx);
        expect(redactIdx).toBeGreaterThan(-1);
    });
});
