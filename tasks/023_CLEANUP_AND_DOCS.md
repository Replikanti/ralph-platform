# Task 023: Cleanup and Documentation Update

## Objective
Remove old source files, update configuration files, and refresh documentation to reflect the new Ts.ED architecture.

## Prerequisites
- 022 (integration verified, all tests passing)

## Deliverables
- Old source files removed
- Updated `package.json` scripts
- Updated `CLAUDE.md`
- Updated `Dockerfile` (if entry point changed)

## Instructions

### 1. Remove Old Source Files

Delete the following files that have been replaced by the new architecture:

```
src/server.ts         → replaced by Server.ts + controllers/
src/worker.ts         → replaced by services/WorkerService.ts
src/agent.ts          → replaced by services/AgentOrchestratorService.ts
src/plan-store.ts     → replaced by services/PlanStoreService.ts
src/linear-client.ts  → replaced by services/LinearClientService.ts
src/linear-utils.ts   → replaced by domain/LinearUtils.ts
src/workspace.ts      → replaced by domain/WorkspaceManager.ts
src/tools.ts          → replaced by domain/AgentTools.ts
src/plan-formatter.ts → replaced by domain/PlanFormatter.ts
src/security/redactor.ts → replaced by domain/PiiRedactor.ts
```

**Do NOT delete:**
- `src/mcp-toonify.ts` (standalone ESM, excluded from build)

### 2. Remove Old Test Files

```
tests/server.test.ts       → replaced by tests/controllers/WebhookController.test.ts
tests/agent.test.ts        → replaced by tests/services/AgentOrchestratorService.test.ts
tests/worker.test.ts       → replaced by tests/services/WorkerService.test.ts
tests/plan-store.test.ts   → replaced by tests/services/PlanStoreService.test.ts
tests/linear-client.test.ts → replaced by tests/services/LinearClientService.test.ts
tests/tools.test.ts        → replaced by tests/domain/AgentTools.test.ts
tests/workspace.test.ts    → replaced by tests/domain/WorkspaceManager.test.ts
tests/plan-formatter.test.ts → replaced by tests/domain/PlanFormatter.test.ts
```

**Keep:**
- `tests/fixtures/` (shared test data still used)

### 3. Update package.json Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "start:api": "node dist/index.js",
    "start:worker": "node dist/index.js",
    "test": "NODE_OPTIONS=--experimental-vm-modules npx jest"
  }
}
```

**Note:** In the Ts.ED architecture, API and Worker run in the same process (WorkerService starts automatically via `$onInit`). The separate `start:worker` script becomes an alias for `start:api`. If separate processes are still needed, add a flag (e.g., `WORKER_ONLY=true`) to conditionally start the worker.

### 4. Update Dockerfile

Change the CMD to use the new entry point:

```dockerfile
CMD ["node", "dist/index.js"]
```

(Previously: `CMD ["node", "dist/server.js"]`)

### 5. Update CLAUDE.md

Update these sections to reflect the new architecture:

- **Key components**: Update file paths (controllers/, services/, domain/)
- **Development Commands**: Update entry points
- **Architecture Flow**: Same flow, different file locations
- **Testing Strategy**: Mention PlatformTest pattern
- **Critical Implementation Details**: Update file references

Key changes to document:
- Server bootstrap: `src/Server.ts` with `@Configuration`
- Entry point: `src/index.ts` (imports reflect-metadata)
- Controllers: `src/controllers/WebhookController.ts`, `src/controllers/SystemController.ts`
- Services: All in `src/services/`
- Domain: Pure logic in `src/domain/` (no DI decorators)
- Tests use `PlatformTest` for service/controller testing
- Swagger docs at `/api-docs`

### 6. Verify Everything

```bash
# Clean build
rm -rf dist/
npm run build

# Run tests
npm test

# Smoke test
docker-compose up --build
curl http://localhost:3000/health
```

### Important Notes

- **Delete files only after verifying the new code works end-to-end.**
- If any old import references remain, the build will fail after deletion - fix them first.
- The `security/` directory can be removed after deleting `redactor.ts` (if empty).
- `src/mcp-toonify.ts` stays - it's built separately.

## Acceptance Criteria
- [ ] All old source files removed (listed above)
- [ ] All old test files removed
- [ ] `package.json` scripts updated
- [ ] `Dockerfile` CMD updated
- [ ] `CLAUDE.md` updated with new architecture
- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes
- [ ] `docker-compose up --build` starts successfully
- [ ] `/health` endpoint works
- [ ] No references to deleted files remain
