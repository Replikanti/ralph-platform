# Security Remediation Plan: PII & Data Leakage to LLM

**Date**: 2026-02-28
**Based on**: Security audit of ralph-platform data flows to Claude LLM
**Branch convention**: `fix/pii-*` or `security/*`
**Tests**: `bun test` (all 121 tests must pass after each change)

---

## Background

Ralph sends data to Claude in three distinct paths:

```
1. PLANNING   task.title + task.description + previousErrors → b.PlanTask()  → BAML proxy → Claude CLI
2. EXECUTION  plan (from LLM)                                → runClaude()   → Claude CLI directly
3. SUMMARIZE  validationOutput (TSC/Biome/Ruff stderr)       → b.SummarizeFailure() → BAML proxy → Claude CLI
```

Additionally, sensitive data leaks into **structured logs** (Pino → observability stack).

The existing `redactText()` pipeline (in `src/security/redactor.ts`) covers:
- AWS keys, GitHub PATs, Linear API keys, Slack tokens, Google API keys, private key headers
- Generic high-entropy secret assignments
- Email, credit card, phone, SSN (via `@redactpii/node`)

Gaps identified below must be closed.

---

## Issues to Fix (ordered by priority)

---

### FIX 1 — Redactor fail-open behaviour (CRITICAL)

**File**: `src/security/redactor.ts:66-69`

**Problem**: When `@redactpii/node` throws (e.g. library bug, OOM), the catch block silently
returns the **original unredacted text**. This silently bypasses the entire security layer.

**Current code**:
```typescript
} catch (e) {
    logger.warn({ err: e }, '⚠️ Redaction failed, returning original text (fail-open for stability, but logged)');
    return text;   // ← UNSAFE: original text returned
}
```

**Required change**: Replace fail-open with fail-closed. If redaction cannot complete, throw
an error so the caller fails explicitly rather than sending sensitive data to the LLM.

```typescript
} catch (e) {
    logger.error({ err: e }, '❌ Redaction failed — refusing to continue to prevent PII/secret leakage');
    throw new Error('Redaction pipeline failed; aborting to prevent data leakage');
}
```

**Impact on callers**: Any code that calls `redactText()` and does not already propagate errors
will now surface a visible failure instead of silently leaking data. This is the intended
behaviour.

**Tests to update**: `tests/` — search for any test that mocks `redactText` to throw and
expects the original text to be returned; update those expectations.

---

### FIX 2 — task.title not redacted before PlanTask (HIGH)

**File**: `src/agent/agent.ts:176`

**Problem**: `task.title` (the Linear issue title, written by a human) is sent directly to
`b.PlanTask()` without redaction. A user could include an email address, phone number,
or a secret in the ticket title.

**Current code** (`planPhase` function):
```typescript
const result = await b.PlanTask({
    title: task.title,                                      // ← not redacted
    description: await redactText(task.description ?? ''),
    skills: availableSkills,
    previousErrors: previousErrors ? [previousErrors] : [],
});
```

**Required change**:
```typescript
const result = await b.PlanTask({
    title: await redactText(task.title),                    // ← add redaction
    description: await redactText(task.description ?? ''),
    skills: availableSkills,
    previousErrors: previousErrors ? [previousErrors] : [],
});
```

Note: `redactText` is already imported in this function (`const { redactText } = await import('../security/redactor')`), so no new import is needed.

---

### FIX 3 — previousErrors not redacted before PlanTask (HIGH)

**File**: `src/agent/agent.ts:179`

**Problem**: `previousErrors` is the accumulated validation output from a failed previous
iteration (TSC errors, Biome output, Ruff, etc.). These tool outputs can contain fragments
of source files, stack traces, or env variable values that appeared in code being linted.

**Current code** (`planPhase` function):
```typescript
previousErrors: previousErrors ? [previousErrors] : [],    // ← not redacted
```

**Required change**:
```typescript
previousErrors: previousErrors ? [await redactText(previousErrors)] : [],  // ← add redaction
```

---

### FIX 4 — validationOutput not redacted before SummarizeFailure (HIGH)

**File**: `src/agent/agent.ts:47`

**Problem**: `errors` (the raw polyglot validation output) is passed to `b.SummarizeFailure()`
without any redaction. Validation tools (Trivy, TSC, Ruff) can embed secrets found in scanned
files directly into their stderr output.

**Current code** (`summarizeFailurePhase` function):
```typescript
const result = await b.SummarizeFailure({
    validationOutput: errors.substring(0, 2000),            // ← not redacted
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
});
```

**Required change**:
```typescript
const { redactText } = await import('../security/redactor');
const result = await b.SummarizeFailure({
    validationOutput: await redactText(errors.substring(0, 2000)),  // ← add redaction
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
});
```

---

### FIX 5 — BAML proxy has no redaction layer (HIGH)

**File**: `src/infra/baml-proxy.ts:92-103`

**Problem**: The BAML proxy is a pass-through HTTP server. It receives the full rendered
BAML prompt (system + user messages concatenated) and forwards it directly to Claude CLI
without any redaction. If BAML renders a prompt that contains a secret (e.g., from a
`previousErrors` field that slipped through), it reaches the LLM unfiltered.

This is a **defence-in-depth** layer: upstream callers should already redact, but the proxy
is the last gate before Claude CLI and should not trust its callers.

**Current code**:
```typescript
app.post('/v1/chat/completions', async (req, res) => {
    const body = req.body as ChatCompletionRequest;
    const model = body.model ?? 'claude-sonnet-4-5-20250929';
    const prompt = buildPromptFromMessages(body.messages ?? []);

    const { homeDir, cleanup } = await setupTempHome();
    try {
        const { stdout } = await runClaude(
            ['-p', prompt, '--model', model, '--tools', '', '--no-session-persistence'],
```

**Required change**: Import `redactText` and apply it to the assembled prompt before
passing to `runClaude`:

```typescript
import { redactText } from './redactor';    // add at top of file (static import OK here)

// inside the POST handler:
const prompt = buildPromptFromMessages(body.messages ?? []);
const redactedPrompt = await redactText(prompt);

const { homeDir, cleanup } = await setupTempHome();
try {
    const { stdout } = await runClaude(
        ['-p', redactedPrompt, '--model', model, '--tools', '', '--no-session-persistence'],
```

Note: Use a **static import** (not dynamic) here — `baml-proxy.ts` does not have the
Bun test mock isolation issue that `agent.ts` had (the proxy is not imported in test files).

---

### FIX 6 — comment.body logged without redaction (MEDIUM)

**File**: `src/platform/server.ts:291`

**Problem**: The first 100 characters of a user's Linear comment are logged verbatim.
Comments are free-form human text and may contain secrets or PII.

**Current code**:
```typescript
logger.info(`   Comment Body: "${comment.body.substring(0, 100)}..."`);
```

**Required change**: Redact the snippet before logging.

```typescript
// add import at top of server.ts if not already present:
import { redactText } from '../security/redactor';

// in the comment handler:
const safeBody = await redactText(comment.body.substring(0, 100));
logger.info(`   Comment Body: "${safeBody}..."`);
```

Note: `redactText` is async — make sure the surrounding function is `async` (it already is).

---

### FIX 7 — issue.title logged without redaction (MEDIUM)

**File**: `src/platform/server.ts:353` and `src/platform/server.ts:357`

**Problem**: `issue.title` is logged on two lines without redaction.

**Current code**:
```typescript
// line 353:
logger.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}". Skipping issue: ${issue.title}`);

// line 357:
logger.info(`📥 [API] Enqueueing Ticket: ${issue.title} (team: ${teamKey || 'default'}, repo: ${repoUrl})`);
```

**Required change**:
```typescript
const safeTitle = await redactText(issue.title);

logger.warn(`⚠️ [API] No repository configured for team "${teamKey || 'unknown'}". Skipping issue: ${safeTitle}`);
// ...
logger.info(`📥 [API] Enqueueing Ticket: ${safeTitle} (team: ${teamKey || 'default'}, repo: ${repoUrl})`);
```

Compute `safeTitle` once and reuse it for both log lines. Place the `await redactText(...)` call
after the `repoUrl` lookup (where `issue.title` is first used in that block).

---

## Files to change — summary

| File | Fixes |
|------|-------|
| `src/security/redactor.ts` | FIX 1 |
| `src/agent/agent.ts` | FIX 2, FIX 3, FIX 4 |
| `src/infra/baml-proxy.ts` | FIX 5 |
| `src/platform/server.ts` | FIX 6, FIX 7 |

---

## Out of scope (intentional decisions)

The following were considered and **deliberately excluded** from this remediation:

| Item | Reason |
|------|--------|
| Validation errors sent to `SummarizeFailure` — after FIX 4, they are redacted | Covered |
| `executePhase` plan (from LLM output) redaction | Plan is generated by our own LLM call; re-sending to Claude with redaction would distort code/file-path references in the plan and break execution. Accepted risk. |
| Redis plan storage encryption (data at rest) | Out of scope for this PR; tracked separately if needed |
| `runCommand` stdout/stderr in logs | Already redacted inside `tools.ts:runCommand` before being returned |
| `readFile` content | Already redacted inside `tools.ts:readFile` before being returned |

---

## Verification checklist

After implementing all fixes:

- [ ] `bun test` — all 121 tests pass
- [ ] Search for any test that expects `redactText` to return original text on failure — update to expect a thrown error
- [ ] Manually verify: create a Linear ticket with a fake email in the title (e.g., `Fix bug for test@example.com`) and confirm the log line shows `<EMAIL_REDACTED>`
- [ ] Confirm BAML proxy logs no sensitive data (check `logger.error` calls in baml-proxy.ts)
- [ ] SonarCloud scan shows no new security hotspots

---

## Suggested PR structure

Create a single PR `fix/pii-redact-remaining-surfaces` targeting `main`:

```
fix/pii-redact-remaining-surfaces
├── src/security/redactor.ts   (FIX 1)
├── src/agent/agent.ts         (FIX 2, 3, 4)
├── src/infra/baml-proxy.ts    (FIX 5)
└── src/platform/server.ts     (FIX 6, 7)
```

All changes are in one PR because they form a single coherent security boundary.
Splitting them would leave the system partially protected during the review window.
