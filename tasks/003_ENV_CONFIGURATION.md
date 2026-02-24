# Task 003: Centralized Environment Configuration

## Objective
Create `src/config/env.ts` that validates and exports all environment variables as typed constants. This replaces scattered `process.env.XXX` reads throughout the codebase.

## Prerequisites
- 002 (directory structure exists)

## Reference Files
- `src/server.ts` lines 25-27, 30, 48-49, 136-137 (env var reads)
- `src/worker.ts` lines 9, 44 (REDIS_URL)
- `src/agent.ts` lines 89, 199, 343, 589 (various env vars)
- `.env.example` (complete list of env vars)

## Deliverables
- `src/config/env.ts`

## Instructions

Create `src/config/env.ts` that:

1. Loads `dotenv` once at import time
2. Validates required variables exist (or provides defaults)
3. Exports typed constants

```typescript
import dotenv from "dotenv";
dotenv.config();

// --- Redis ---
export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// --- GitHub ---
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

// --- Anthropic ---
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// --- Linear ---
export const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET || "";
export const LINEAR_API_KEY = process.env.LINEAR_API_KEY || "";

// --- Plan Review ---
export const PLAN_REVIEW_ENABLED = process.env.PLAN_REVIEW_ENABLED !== "false";
export const PLAN_TTL_DAYS = parseInt(process.env.PLAN_TTL_DAYS || "7", 10);

// --- Repository Config ---
export const REPO_CONFIG_PATH = process.env.REPO_CONFIG_PATH || "/etc/ralph/config/repos.json";
export const DEFAULT_REPO_URL = process.env.DEFAULT_REPO_URL || "";
export const LINEAR_TEAM_REPOS_JSON = process.env.LINEAR_TEAM_REPOS || "{}";

// --- Langfuse ---
export const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY || "";
export const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY || "";
export const LANGFUSE_HOST = process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";

// --- Admin Dashboard ---
export const ADMIN_USER = process.env.ADMIN_USER || "";
export const ADMIN_PASS = process.env.ADMIN_PASS || "";

// --- Agent ---
export const CLAUDE_BIN_PATH = process.env.CLAUDE_BIN_PATH || "/usr/local/bin/claude";
export const CLAUDE_CACHE_PATH = process.env.CLAUDE_CACHE_PATH || "/app/claude-cache";
```

### Important Notes

- Do NOT remove `dotenv.config()` calls from existing files yet. This module will coexist with the old code during migration.
- Do NOT add runtime validation that throws on missing vars - Ralph has graceful degradation (e.g., Linear features disabled when LINEAR_API_KEY is missing).
- Export as `const` values, not as a class. Keep it simple.

## Acceptance Criteria
- [ ] `src/config/env.ts` exports all environment variables used across the codebase
- [ ] All exports are typed (string, boolean, number)
- [ ] `dotenv.config()` is called at import time
- [ ] `npm run build` compiles without errors
- [ ] No existing files were modified
