# Ralph Platform - Improvement Plan

**Created**: 2026-02-05
**Author**: Claude Opus 4.5 (comprehensive review)
**For**: Claude Sonnet 4.5 (implementation)
**Status**: Ready for implementation

---

## Executive Summary

Ralph Platform má solidní základ pro všechny 4 jazykové moduly (TypeScript/JavaScript, Python, Go, Terraform), ale vyžaduje vylepšení v oblastech dokumentace, Langfuse trackingu a language-specific skills pro dosažení plné efektivity a připravenosti na self-improvement loop.

---

## 1. Current State Analysis

### Language Modules Status

| Jazyk | Validační nástroje | Dockerfile | Dokumentace | Skills | Status |
|-------|-------------------|------------|-------------|--------|--------|
| **TypeScript/JS** | Biome + TSC | ✅ | ✅ | ❌ | ✅ Production |
| **Python** | Ruff + Mypy | ✅ | ✅ | ❌ | ✅ Production |
| **Go** | goimports + golangci-lint + go build | ✅ | ⚠️ Partial | ❌ | ✅ Ready |
| **Terraform** | terraform fmt + validate + tflint | ✅ | ⚠️ Partial | ❌ | ✅ Ready |
| **Security** | Trivy (all languages) | ✅ | ✅ | - | ✅ Production |

### Key Gaps Identified

1. **Documentation outdated** - Go/Terraform not fully documented
2. **No language-specific skills** - Missing guidance for language idioms
3. **Langfuse tracking insufficient** - Cannot build self-improvement loop
4. **No validation result tracking** - Cannot analyze failure patterns

---

## 2. Implementation Sprints

### Sprint 1: Documentation Update (Priority: HIGH)

**Goal**: Ensure all documentation reflects current capabilities including Go and Terraform support.

#### Task 1.1: Update USER_GUIDE.md
**File**: `USER_GUIDE.md`
**Changes**:
- Add Go project workflow example (similar to existing Python/TypeScript examples)
- Add Terraform project workflow example
- Update "Validation Failures" section to mention Go/Terraform tools
- Add best practices for Go projects (go.mod, module structure)
- Add best practices for Terraform projects (terraform init, state management notes)

**Example content to add**:
```markdown
### Example 4: Go Feature Implementation

```
Linear Issue:
  Title: Add HTTP middleware for logging
  Label: Ralph
  Description: Add request/response logging middleware to the Go API

Ralph's Plan:
  1. Create middleware/logging.go
  2. Implement http.Handler wrapper
  3. Add request ID generation
  4. Log request/response with timing
  5. Update main.go to use middleware

You: "LGTM"

Ralph: Creates PR with implementation
  - Runs goimports for formatting
  - Runs golangci-lint for code quality
  - Runs go build to verify compilation
```

### Example 5: Terraform Infrastructure Change

```
Linear Issue:
  Title: Add S3 bucket for logs
  Label: Ralph
  Description: Create S3 bucket with lifecycle rules for log storage

Ralph's Plan:
  1. Create modules/s3-logs/main.tf
  2. Define bucket with versioning
  3. Add lifecycle rules (30 day transition to IA)
  4. Add IAM policy for write access
  5. Output bucket ARN

You: "approved"

Ralph: Creates PR with implementation
  - Runs terraform fmt for formatting
  - Runs terraform validate for syntax
  - Runs tflint for best practices
```
```

#### Task 1.2: Update DEPLOYMENT.md
**File**: `DEPLOYMENT.md`
**Changes**:
- Update Docker image size information (now ~1.4GB with Go + Terraform)
- Add Go toolchain dependencies section
- Add Terraform/tflint dependencies section
- Update Prerequisites table with new tools

**Content to add after line 16**:
```markdown
| `go` | 1.23.5 | Included in Docker image |
| `goimports` | latest | Included in Docker image |
| `golangci-lint` | 1.56.2 | Included in Docker image |
| `terraform` | 1.7.5 | Included in Docker image |
| `tflint` | 0.53.0 | Included in Docker image |
```

**Add new section "Docker Image Size"**:
```markdown
### Docker Image Size

The Ralph Docker image includes all polyglot toolchains:

| Component | Size Impact |
|-----------|-------------|
| Node.js base | ~400 MB |
| Go toolchain | ~500 MB |
| Terraform + tflint | ~100 MB |
| Python tools | ~200 MB |
| Claude CLI + Trivy | ~200 MB |
| **Total** | **~1.4 GB** |

For smaller images, consider building language-specific variants.
```

#### Task 1.3: Update ARCHITECTURE.md
**File**: `ARCHITECTURE.md`
**Changes**:
- Ensure Terraform is fully documented in Tools section (around line 175)
- Update validation flow diagram if needed
- Verify all tool versions are current

**Verify this content exists around line 175-180**:
```markdown
- **Terraform**: terraform fmt + terraform validate + tflint
```

#### Task 1.4: Verify README.md
**File**: `README.md`
**Action**: Read and verify the features list includes:
- Go in polyglot validation list
- Terraform in polyglot validation list
- Updated tool list

**Expected content (verify exists)**:
```markdown
- **Polyglot Validation** - Auto-detect and validate TypeScript, JavaScript, Python, Go, and Terraform projects
```

#### Task 1.5: Archive Implementation Plan
**Action**:
```bash
mkdir -p docs/archive
git mv PLAN_GO_TERRAFORM_SUPPORT.md docs/archive/
```
**Reason**: Plan has been implemented, keeping for historical reference.

---

### Sprint 2: Language-Specific Skills (Priority: MEDIUM)

**Goal**: Create skill files that provide language-specific guidance to Ralph when working on different project types.

#### Task 2.1: Create TypeScript/JavaScript Skill
**File**: `.claude/commands/typescript/SKILL.md`
**Content**:
```markdown
---
name: typescript
description: Best practices and patterns for TypeScript/JavaScript development
---

# TypeScript/JavaScript Development Guide

## Code Style
- Use strict TypeScript (`"strict": true` in tsconfig.json)
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw Promises
- Export types alongside functions

## Common Patterns
- Use discriminated unions for state management
- Prefer composition over inheritance
- Use `unknown` instead of `any` when type is uncertain

## Testing
- Co-locate tests with source files or use `__tests__` directories
- Use descriptive test names: `it('should return empty array when input is null')`
- Mock external dependencies, not internal modules

## Error Handling
- Create custom error classes extending Error
- Always include error context in messages
- Use Result pattern for expected failures

## Biome/ESLint
- Run `biome check --apply .` before committing
- Address all lint warnings, don't disable rules without justification
```

#### Task 2.2: Create Python Skill
**File**: `.claude/commands/python/SKILL.md`
**Content**:
```markdown
---
name: python
description: Best practices and patterns for Python development
---

# Python Development Guide

## Code Style
- Follow PEP 8 (enforced by Ruff)
- Use type hints for all public functions
- Prefer f-strings over .format() or %

## Common Patterns
- Use dataclasses or Pydantic for data structures
- Use context managers for resource management
- Prefer pathlib over os.path

## Testing
- Use pytest with descriptive test function names
- Use fixtures for test setup
- Use parametrize for multiple test cases

## Error Handling
- Create custom exceptions inheriting from appropriate base
- Use `raise ... from e` to preserve stack traces
- Document exceptions in docstrings

## Type Checking
- Run `mypy --ignore-missing-imports .` before committing
- Use `Optional[T]` for nullable values
- Use `TypeVar` for generic functions
```

#### Task 2.3: Create Go Skill
**File**: `.claude/commands/golang/SKILL.md`
**Content**:
```markdown
---
name: golang
description: Best practices and patterns for Go development
---

# Go Development Guide

## Code Style
- Follow Effective Go guidelines
- Use goimports for formatting and import management
- Keep functions short and focused

## Common Patterns
- Accept interfaces, return structs
- Use table-driven tests
- Handle errors explicitly, don't ignore them
- Use context.Context for cancellation and timeouts

## Package Organization
- Keep package names short and lowercase
- Avoid package-level state when possible
- Use internal/ for private packages

## Error Handling
- Return errors, don't panic (except in truly unrecoverable situations)
- Wrap errors with context: `fmt.Errorf("failed to connect: %w", err)`
- Use sentinel errors for expected conditions

## Testing
- Place tests in same package (white-box) or _test package (black-box)
- Use testify/assert for cleaner assertions
- Use t.Parallel() for independent tests

## golangci-lint
- Address all linter warnings
- Common issues: ineffassign, errcheck, staticcheck
```

#### Task 2.4: Create Terraform Skill
**File**: `.claude/commands/terraform/SKILL.md`
**Content**:
```markdown
---
name: terraform
description: Best practices and patterns for Terraform/Infrastructure as Code
---

# Terraform Development Guide

## Code Style
- Use `terraform fmt` for consistent formatting
- Use snake_case for resource names
- Group related resources in same file

## Module Structure
```
modules/
  module-name/
    main.tf       # Primary resources
    variables.tf  # Input variables
    outputs.tf    # Output values
    README.md     # Module documentation
```

## Best Practices
- Use modules for reusable infrastructure
- Pin provider versions in required_providers
- Use data sources instead of hardcoding IDs
- Store state remotely (S3, GCS, Terraform Cloud)

## Naming Conventions
- Resources: `{provider}_{type}` (e.g., `aws_s3_bucket`)
- Variables: descriptive snake_case (e.g., `bucket_name`)
- Outputs: match the attribute being exposed

## Security
- Never commit secrets to .tf files
- Use variables or secret managers for sensitive values
- Enable encryption for storage resources
- Use least-privilege IAM policies

## Validation
- `terraform validate` checks syntax
- `tflint` checks best practices and cloud-specific rules
- Trivy scans for security misconfigurations
```

#### Task 2.5: Update Skills README
**File**: `.claude/commands/README.md`
**Content**:
```markdown
# Claude Commands for Ralph Platform

This directory contains Claude Code commands (skills) that provide context-specific guidance.

## Available Commands

| Command | Description |
|---------|-------------|
| `/project-map` | Lists project structure in token-optimized format |
| `/test-filter` | Runs tests and shows only errors |
| `/trace-deps` | Finds files that depend on a given file |
| `/ralph-platform` | Ralph Platform development guidelines |
| `/typescript` | TypeScript/JavaScript best practices |
| `/python` | Python development best practices |
| `/golang` | Go development best practices |
| `/terraform` | Terraform/IaC best practices |

## Adding Custom Commands

To add a custom command for your repository:

1. Create directory: `.claude/commands/{command-name}/`
2. Add `SKILL.md` with frontmatter:
   ```markdown
   ---
   name: command-name
   description: Brief description
   ---

   # Command Title

   Your guidance content here...
   ```
3. Commit to your repository
4. Ralph will automatically detect and use these commands

## Best Practices for Skills

- Keep skills focused on one topic
- Include concrete examples
- Reference specific tools and their flags
- Update skills based on common errors from Langfuse data
```

---

### Sprint 3: Langfuse Enhancement (Priority: CRITICAL)

**Goal**: Add rich metadata to Langfuse traces to enable data-driven self-improvement.

#### Task 3.1: Add Language Detection Function
**File**: `src/tools.ts`
**Location**: Add after the imports, around line 10
**Content**:
```typescript
// Language detection for Langfuse tracking
export async function detectProjectLanguages(workDir: string): Promise<string[]> {
    const languages: string[] = [];

    // TypeScript/JavaScript
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
        const hasTs = fs.existsSync(path.join(workDir, 'tsconfig.json'));
        languages.push(hasTs ? 'typescript' : 'javascript');
    }

    // Python
    if (fs.existsSync(path.join(workDir, 'pyproject.toml')) ||
        fs.existsSync(path.join(workDir, 'requirements.txt'))) {
        languages.push('python');
    }

    // Go
    if (fs.existsSync(path.join(workDir, 'go.mod'))) {
        languages.push('go');
    }

    // Terraform (async check for .tf files)
    try {
        const { stdout } = await execAsync('find . -maxdepth 3 -name "*.tf" -type f | head -1', { cwd: workDir });
        if (stdout.trim().length > 0) {
            languages.push('terraform');
        }
    } catch { /* ignore */ }

    return languages;
}
```

#### Task 3.2: Create Structured Validation Result Type
**File**: `src/tools.ts`
**Location**: Add before runPolyglotValidation function
**Content**:
```typescript
// Structured validation result for Langfuse tracking
export interface ToolResult {
    success: boolean;
    errorCount: number;
    relevantErrorCount: number;
    duration?: number;
}

export interface ValidationResult {
    success: boolean;
    output: string;
    languages: string[];
    toolResults: Record<string, ToolResult>;
    totalErrors: number;
    relevantErrors: number;
}
```

**Modify runPolyglotValidation to return ValidationResult**:
- Track individual tool results
- Calculate totals
- Return structured data

#### Task 3.3: Add Language Metadata to Trace
**File**: `src/agent.ts`
**Location**: In the main task handler, around line 552
**Changes**:
```typescript
// Before creating trace, detect languages
const detectedLanguages = await detectProjectLanguages(workDir);

return withTrace("Ralph-Task", {
    ticketId: task.ticketId,
    mode: actualMode,
    languages: detectedLanguages,           // NEW
    repository: task.repoUrl,               // NEW
    taskType: detectTaskType(task.title)    // NEW - implement simple heuristic
}, async (trace: any) => {
    // ... existing code
});
```

**Add task type detection helper**:
```typescript
function detectTaskType(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('fix') || lower.includes('bug')) return 'bugfix';
    if (lower.includes('refactor')) return 'refactor';
    if (lower.includes('test')) return 'test';
    if (lower.includes('doc')) return 'docs';
    return 'feature';
}
```

#### Task 3.4: Add Validation Span with Details
**File**: `src/agent.ts`
**Location**: After runPolyglotValidation call in runIteration
**Changes**:
```typescript
const validationSpan = ctx.trace.span({
    name: "Validation",
    metadata: { iteration }
});

const check = await runPolyglotValidation(ctx.workDir);

validationSpan.end({
    output: check.output,
    metadata: {
        success: check.success,
        languages: check.languages,
        toolResults: check.toolResults,
        totalErrors: check.totalErrors,
        relevantErrors: check.relevantErrors
    }
});
```

#### Task 3.5: Add Cost Tracking
**File**: `src/agent.ts`
**Location**: After Claude CLI calls
**Changes**: Parse Claude CLI output for token usage and add to span metadata.

Note: This requires Claude CLI to output token counts, which may need investigation.

#### Task 3.6: Export for Import
**File**: `src/tools.ts`
**Changes**: Ensure `detectProjectLanguages` and `ValidationResult` are exported.

---

### Sprint 4: Self-Improvement Foundation (Priority: LONG-TERM)

**Goal**: Create infrastructure for analyzing Langfuse data and generating improvement suggestions.

#### Task 4.1: Create Analytics Module
**File**: `src/analytics.ts` (NEW)
**Content**:
```typescript
import { Langfuse } from "langfuse";

export interface AnalyticsReport {
    period: { start: Date; end: Date };
    totalTasks: number;
    successRate: number;
    byLanguage: Record<string, { total: number; success: number; avgIterations: number }>;
    byTaskType: Record<string, { total: number; success: number }>;
    commonErrors: Array<{ pattern: string; count: number; languages: string[] }>;
    avgCostPerTask: number;
}

export async function generateAnalyticsReport(days: number = 7): Promise<AnalyticsReport> {
    // Implementation:
    // 1. Fetch traces from Langfuse API
    // 2. Aggregate by language, task type
    // 3. Calculate success rates
    // 4. Extract common error patterns
    // 5. Return structured report
}

export async function identifyImprovementAreas(report: AnalyticsReport): Promise<string[]> {
    const suggestions: string[] = [];

    // Low success rate languages
    for (const [lang, stats] of Object.entries(report.byLanguage)) {
        if (stats.success / stats.total < 0.7) {
            suggestions.push(`Improve ${lang} skills - success rate ${(stats.success/stats.total*100).toFixed(0)}%`);
        }
    }

    // High iteration tasks
    for (const [lang, stats] of Object.entries(report.byLanguage)) {
        if (stats.avgIterations > 2) {
            suggestions.push(`Optimize ${lang} prompts - avg ${stats.avgIterations.toFixed(1)} iterations`);
        }
    }

    return suggestions;
}
```

#### Task 4.2-4.5: Implement remaining analytics features
See Sprint 4 tasks in original plan.

---

## 3. Self-Improvement Loop Design

```
┌──────────────────────────────────────────────────────────────┐
│                    SELF-IMPROVEMENT LOOP                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. COLLECT DATA (Automatic - Sprint 3)                      │
│     └─> Langfuse traces with:                                │
│         - Detected languages                                 │
│         - Validation tool results                            │
│         - Error counts and patterns                          │
│         - Task types and outcomes                            │
│                                                              │
│  2. ANALYZE (Weekly - Sprint 4)                              │
│     └─> Run: npm run analytics                               │
│     └─> Output: Success rates, common errors, trends         │
│                                                              │
│  3. IDENTIFY IMPROVEMENTS                                    │
│     └─> Low success rate languages → update skills           │
│     └─> Common errors → add to CLAUDE.md warnings            │
│     └─> High iteration tasks → optimize prompts              │
│                                                              │
│  4. IMPLEMENT (Human Review Required)                        │
│     └─> Create Linear issue with suggested changes           │
│     └─> Human reviews and approves                           │
│     └─> Ralph implements the improvement                     │
│                                                              │
│  5. VALIDATE                                                 │
│     └─> Compare metrics after 1 week                         │
│     └─> Iterate if needed                                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Execution Order

**Recommended sequence**:

1. **Sprint 1** (Documentation) - Immediate, enables users
2. **Sprint 3** (Langfuse) - Critical, enables data collection
3. **Sprint 2** (Skills) - Medium priority, improves quality
4. **Sprint 4** (Analytics) - After Sprint 3 data accumulates

**Rationale**:
- Users need documentation now
- Langfuse data collection should start ASAP
- Skills can be added iteratively based on Langfuse insights
- Analytics needs data from Sprint 3 first

---

## 5. Success Criteria

### Sprint 1
- [ ] All docs updated and accurate
- [ ] Go/Terraform examples in USER_GUIDE.md
- [ ] Docker size documented in DEPLOYMENT.md

### Sprint 2
- [ ] 4 language skill files created
- [ ] Skills README updated
- [ ] Skills load correctly in Ralph

### Sprint 3
- [ ] Languages tracked in every trace
- [ ] Validation results structured
- [ ] Can query Langfuse by language

### Sprint 4
- [ ] Weekly analytics report generates
- [ ] Improvement suggestions actionable
- [ ] Documented self-improvement workflow

---

## 6. Notes for Implementation

1. **Create feature branch per sprint**: `feat/improvement-sprint-X`
2. **Run tests after each change**: `npm test`
3. **Follow existing code patterns** in src/tools.ts and src/agent.ts
4. **Keep PRs focused** - one sprint per PR ideally
5. **Update CLAUDE.md** if adding new capabilities

---

**End of Implementation Plan**
