---
name: ralph-platform
description: Development guidelines and practices for the Ralph AI coding agent platform
---

# Ralph Platform Development Skill

This skill provides context and guidelines for developing the Ralph AI coding agent platform.

## Overview

Ralph is an event-driven AI coding agent that:
- Receives tasks from Linear webhooks
- Processes them using Claude AI models (Opus for planning, Sonnet for execution)
- Validates code with polyglot toolchains
- Pushes changes to GitHub

## Development Commands

### Building
```bash
npm run build
```

### Testing
```bash
# Run all tests with coverage
npm test

# Run specific test file
NODE_OPTIONS=--experimental-vm-modules npx jest tests/<filename>.test.ts
```

### Local Development
```bash
# Start entire stack
docker-compose up --build

# Individual services
npm run start:api      # Port 3000
npm run start:worker   # Redis job processor
```

## Architecture

### Key Files
- `src/server.ts` - API server, webhook handling, task queueing
- `src/worker.ts` - BullMQ worker, job processor
- `src/agent.ts` - AI orchestration, Claude CLI invocation
- `src/tools.ts` - Polyglot validation, command execution
- `src/workspace.ts` - Git operations, ephemeral workspaces

### Data Flow
1. Linear webhook → API validates HMAC signature → enqueues to Redis
2. Worker dequeues → clones repo to `/tmp/ralph-workspaces/{uuid}`
3. Agent runs Opus (planning) then Sonnet (execution)
4. Polyglot validation runs on generated code
5. Push to GitHub on `ralph/feat-{identifier}` branch

## Security Rules (CRITICAL)

### Webhook Security
- NEVER bypass HMAC SHA-256 signature verification
- Use timing-safe comparison for signatures

### Command Execution Security
Only these command patterns are allowed:
- Build: `npm test`, `npm run build`, `npx`, `node`
- Git: `git status`, `git log`, `git diff`, `git show`
- Files: `ls`, `cat`, `pwd`, `echo`
- Python: `pytest`, `python -m pytest`, `ruff`, `mypy`

Blocked patterns: `;`, `&`, `|`, backticks, `$()`, `rm -rf`, `> /dev/`

### Path Traversal
- All file operations must validate paths remain within `workDir`
- Use `path.resolve()` + `startsWith()` checks

## Testing Guidelines

### Test Structure
- Use supertest for API endpoints
- Mock all external dependencies (Redis, Anthropic, Langfuse, simple-git)
- Each module has a corresponding test file in `tests/`

### Required Test Files
- `tests/server.test.ts` - Webhook verification, filtering
- `tests/worker.test.ts` - Job processing, retries
- `tests/agent.test.ts` - Skill loading, LLM orchestration
- `tests/workspace.test.ts` - Git operations
- `tests/tools.test.ts` - Validation detection

## Definition of Done

Before completing a task, verify:
1. [ ] Code compiles: `npm run build` passes
2. [ ] Tests pass: `npm test` passes
3. [ ] No security rules violated
4. [ ] Only relevant files modified
5. [ ] No secrets in code

## Examples

### Adding a new webhook endpoint
1. Add route in `src/server.ts`
2. Implement HMAC signature verification
3. Add tests in `tests/server.test.ts`
4. Update README.md if public API changes

### Adding a new validation tool
1. Add detection logic in `src/tools.ts` `runPolyglotValidation()`
2. Ensure it follows timeout/buffer limits
3. Add tests in `tests/tools.test.ts`

### Modifying agent behavior
1. Security guardrails in `src/agent.ts` are immutable
2. Add repo-specific instructions to `.claude/skills/` instead
3. Test with `tests/agent.test.ts`

## Guidelines

1. **Minimal changes**: Only modify files directly related to the task
2. **No over-engineering**: Keep solutions simple and focused
3. **Security first**: Never bypass security controls
4. **Test coverage**: Add tests for new functionality
5. **Clean commits**: Use conventional commit messages (`feat:`, `fix:`, `docs:`)
6. **Workspace cleanup**: Always call `cleanup()` after job completion
