---
name: ralph-platform
description: Project-specific instructions for working on the Ralph Platform codebase.
---

# Ralph Platform Skill

This skill provides guidelines and common commands for developing, testing, and maintaining the Ralph Platform.

## Guidelines

- **Architecture**: Ralph follows a layered event-driven architecture: `src/domain/` (pure logic), `src/platform/` (Express + BullMQ), `src/agent/` (AI loop + git), `src/infra/` (external wrappers).
- **API service**: `src/platform/server.ts`, **Worker**: `src/platform/worker.ts`.
- **Commits**: Use conventional commits (e.g., `feat: ...`, `fix: ...`).
- **PRs**: Ensure that PRs include relevant tests and that all existing tests pass.
- **Safety**: Never expose API keys or secrets in the codebase or logs.
- **Logging**: Use `logger` from `src/infra/logger.ts` (Pino). No `console.log` in `src/`.
- **Tools**: Use the built-in polyglot validation tools and the custom validation logic in `src/agent/tools.ts`.

## BAML Integration

Planning and summarization use [BAML](https://docs.boundaryml.com/) (typed LLM functions) instead of direct `runClaude()` + regex:

```
b.PlanTask() / b.SummarizeFailure()
  → BAML openai-generic client (BAML_PROXY_URL)
  → src/infra/baml-proxy.ts  (Express, port 3001)
  → src/infra/claude-runner.ts → Claude CLI subprocess
```

**Key files:**
- `src/infra/baml/baml_src/` — BAML source files (git-tracked)
- `src/infra/baml/baml_client/` — generated TypeScript client (gitignored, regenerate with `bun run build`)
- `src/infra/baml/index.ts` — re-exports `b` from generated client
- `src/infra/baml-proxy.ts` — OpenAI-compatible HTTP proxy to Claude CLI (uses account pool for credentials)
- `src/infra/claude-runner.ts` — `runClaude()` + `RateLimitError` (with `retryAfterMs`)
- `src/infra/account-pool.ts` — account pool for Claude Max flat-rate credentials rotation

**Regenerate BAML client after editing `.baml` files:**
```bash
node_modules/.bin/baml-cli generate --from src/infra/baml/baml_src
```

**Environment variables for BAML:**
- `BAML_PROXY_PORT` — port for the proxy server (default: 3001)
- `BAML_PROXY_URL` — base URL for BAML clients (default: `http://localhost:3001/v1`)

**Environment variables for Claude Max auth:**
- `CLAUDE_ACCOUNTS_DIR` — directory of account subdirectories with `.credentials.json` (default: `/claude-accounts`)
- `CLAUDE_RATE_LIMIT_TTL_MINUTES` — fallback TTL for rate-limited accounts (default: 60)

**Execute phase** still uses `runClaudeExecution()` directly (needs Claude Code tools).

## Examples

### Running Tests
Run a specific test file (preferred):
```bash
bun test tests/server.test.ts
bun test tests/domain/
```

Run the full suite (orchestrates separate `bun test` invocations per group to avoid mock isolation issues):
```bash
npm test
```

### Building the Project
```bash
bun run build
```

### Adding a New Skill
To add a new skill to the platform, create a new subdirectory in `.ralph/skills/` with a `SKILL.md` file.

## Definition of Done
1. Code is implemented and follows project conventions.
2. Unit tests are added or updated.
3. `bun test` passes for all affected test files.
4. Changes are committed with a meaningful message.
5. A Pull Request is created and linked to the relevant issue.
