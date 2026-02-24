# Task 007: Migrate AgentTools to Domain

## Objective
Copy `src/tools.ts` to `src/domain/AgentTools.ts`, clean up legacy dead code (the `agentTools` Anthropic SDK tool definitions array), and update the import path for the PII redactor.

## Prerequisites
- 006 (PiiRedactor.ts exists in domain/)

## Reference Files
- `src/tools.ts` (full file - 520 lines)
- `src/domain/PiiRedactor.ts` (the new location of redactor)

## Deliverables
- `src/domain/AgentTools.ts`

## Instructions

### 1. Copy and Clean

Copy `src/tools.ts` to `src/domain/AgentTools.ts` with these changes:

#### a) Update the redactor import

Change:
```typescript
import { redactText } from "./security/redactor";
```
To:
```typescript
import { redactText } from "./PiiRedactor";
```

#### b) Remove legacy `agentTools` array

Delete the entire `agentTools` constant (lines 144-189 in current tools.ts). This was the Anthropic SDK tool definition array used when the agent called the API directly. The agent now uses Claude CLI native tools (`--tools 'Bash,Read,Edit,FileSearch,Glob'`), so this array is dead code.

#### c) Keep everything else

Preserve all of these exports:
- `detectProjectLanguages(workDir: string): Promise<string[]>`
- `listFiles(workDir: string, dirPath?: string): Promise<string>`
- `readFile(workDir: string, filePath: string): Promise<string>`
- `writeFile(workDir: string, filePath: string, content: string): Promise<string>`
- `runCommand(workDir: string, command: string): Promise<string>`
- `runPolyglotValidation(workDir: string): Promise<ValidationResult>`
- `ALLOWED_COMMAND_PATTERNS` (array)
- `DANGEROUS_PATTERNS` (array)
- `ValidationResult` interface
- `ToolResult` interface
- All internal validation functions (`validateNode`, `validatePython`, `validateGo`, `validateTerraform`, `validateSecurity`)

### 2. Keep Original File

**Do NOT modify `src/tools.ts`**. It must continue to work for the old code path until the migration is complete.

### Key Rules

- **NO Ts.ED decorators** in this domain file.
- The only import path change is the redactor: `./security/redactor` → `./PiiRedactor`
- All functions remain exported as standalone functions, NOT as class methods.
- The file/command utility functions (`listFiles`, `readFile`, `writeFile`, `runCommand`) are kept for potential future use even though the agent currently uses Claude CLI native tools.

## Acceptance Criteria
- [ ] `src/domain/AgentTools.ts` exists
- [ ] Import of redactor points to `./PiiRedactor` (not `./security/redactor`)
- [ ] `agentTools` array (Anthropic SDK tool definitions) is removed
- [ ] All validation functions preserved (`runPolyglotValidation`, `validateNode`, etc.)
- [ ] All security functions preserved (`ALLOWED_COMMAND_PATTERNS`, `DANGEROUS_PATTERNS`, `runCommand`)
- [ ] No `@tsed/*` imports
- [ ] Original `src/tools.ts` untouched
- [ ] `npm run build` compiles without errors
