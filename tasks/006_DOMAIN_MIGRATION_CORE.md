# Task 006: Migrate Core Domain Files

## Objective
Copy pure logic files to `src/domain/` with updated import paths. These files contain zero business orchestration - only pure functions and utilities.

## Prerequisites
- 002 (directory structure exists)

## Reference Files
- `src/workspace.ts` (53 lines - git workspace management)
- `src/security/redactor.ts` (PII/secret redaction)
- `src/plan-formatter.ts` (38 lines - plan markdown formatting)
- `src/linear-utils.ts` (33 lines - state synonym mapping)

## Deliverables
- `src/domain/WorkspaceManager.ts`
- `src/domain/PiiRedactor.ts`
- `src/domain/PlanFormatter.ts`
- `src/domain/LinearUtils.ts`

## Instructions

### 1. WorkspaceManager.ts

Copy `src/workspace.ts` to `src/domain/WorkspaceManager.ts` **verbatim**. No changes to logic.

The file exports:
- `parseRepoUrl(repoUrl: string): { owner: string, repo: string }`
- `setupWorkspace(repoUrl: string, branchName: string): Promise<{ workDir, rootDir, git, cleanup }>`

No import path changes needed - it only imports from `simple-git`, `node:fs`, `node:fs/promises`, `uuid`, `node:path`.

### 2. PiiRedactor.ts

Copy `src/security/redactor.ts` to `src/domain/PiiRedactor.ts` **verbatim**. No changes to logic.

The file exports:
- `redactText(text: string): Promise<string>`

It imports from `@redactpii/node` which is already in package.json.

**Keep `src/security/redactor.ts` as-is** during migration. The existing `src/tools.ts` imports from `./security/redactor` and must continue to work until Task 007 updates that import.

### 3. PlanFormatter.ts

Copy `src/plan-formatter.ts` to `src/domain/PlanFormatter.ts` **verbatim**. No changes to logic.

The file exports:
- `formatPlanForLinear(plan: string, taskTitle: string): string`

No external imports.

### 4. LinearUtils.ts

Copy `src/linear-utils.ts` to `src/domain/LinearUtils.ts` **verbatim**. No changes to logic.

The file exports:
- `findTargetState(team: any, statusName: string): Promise<state | null>`

No external imports.

### Key Rules

- **NO Ts.ED decorators** in domain files. These are pure TypeScript modules.
- **NO modifications to logic.** Copy verbatim. The only allowed changes are:
  - Adding re-exports if needed for backwards compatibility
- **Keep original files** during migration. They'll be removed in Task 023.
- Domain files should be importable from anywhere - they have no dependency on the Ts.ED DI container.

## Acceptance Criteria
- [ ] `src/domain/WorkspaceManager.ts` exists with same content as `src/workspace.ts`
- [ ] `src/domain/PiiRedactor.ts` exists with same content as `src/security/redactor.ts`
- [ ] `src/domain/PlanFormatter.ts` exists with same content as `src/plan-formatter.ts`
- [ ] `src/domain/LinearUtils.ts` exists with same content as `src/linear-utils.ts`
- [ ] No Ts.ED imports (`@tsed/*`) in any domain file
- [ ] Original files are untouched
- [ ] `npm run build` compiles without errors
- [ ] `npm test` still passes
