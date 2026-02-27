# Ralph Platform - AI Coding Agent

Ralph is an event-driven AI coding agent platform that automates software development tasks. It processes Linear issues, utilizes Claude AI (Sonnet 4.5 for planning and execution with budget limits, Haiku 4.5 for error summarization) to generate code, validates changes using polyglot toolchains, and pushes pull requests to GitHub.

## Project Overview

*   **Type:** TypeScript / Bun Application
*   **Architecture:** Event-driven microservices (API + Worker) backed by Redis.
*   **Infrastructure:** Kubernetes (GKE), Terraform, Helm.
*   **AI Models:** Anthropic Claude (Sonnet 4.5 for planning & coding, Haiku 4.5 for error summarization).

## Architecture & Data Flow

1.  **Trigger:** A Linear issue with the label `Ralph` triggers a webhook.
2.  **API Service (`src/platform/server.ts`):** Receives the webhook, validates the HMAC signature, parses payload with Zod, and enqueues the task into Redis (BullMQ).
3.  **Worker Service (`src/platform/worker.ts`):** Dequeues the task and initializes the Agent.
4.  **Agent (`src/agent/agent.ts`):**
    *   **Workspace:** Clones the target repository into an ephemeral directory (default: `/tmp/ralph-workspaces`).
    *   **Planning:** Uses Claude Sonnet 4.5 to create an implementation plan ($0.50 budget limit).
    *   **Coding:** Uses Claude Sonnet to generate code based on the plan.
    *   **Validation:** Runs language-specific tools (Biome, TSC, Ruff, Mypy, goimports, Trivy) via `src/agent/tools.ts`.
5.  **Output:** Commits changes and pushes a new branch/PR to GitHub.
6.  **Observability:** Execution traces are sent to Langfuse.

## Development Workflow

### Prerequisites
*   Bun (v1+) — `curl -fsSL https://bun.sh/install | bash`
*   Docker & Docker Compose
*   Redis (local or via Docker)

### Installation
```bash
bun install
```

### Build
Bundle to `dist/` using Bun's native bundler:
```bash
bun run build
```

### Running Locally
You can run the full stack using Docker Compose:
```bash
cp .env.example .env  # Configure API keys first
docker-compose up --build
```

Or run services individually (requires running Redis):
```bash
# Terminal 1: API
bun run src/platform/server.ts

# Terminal 2: Worker
bun run src/platform/worker.ts
```

### Testing
The project uses Bun's built-in test runner (`bun:test`, Jest-compatible API).
```bash
# Run all tests
npm test

# Run a specific test file
bun test tests/server.test.ts

# Run in watch mode
bun test --watch
```

## Project Structure

*   `src/`
    *   `domain/`: Pure business logic — webhook routing, agent outcome mapping, shared types. No framework deps.
    *   `platform/`
        *   `server.ts`: API entry point. Handles webhooks, Zod validation, and queuing.
        *   `worker.ts`: Worker entry point. Processes jobs from Redis, orchestrates Linear/plan updates.
    *   `agent/`
        *   `agent.ts`: Core AI logic (plan-only / execute-only / full modes).
        *   `tools.ts`: Polyglot validation tools (Biome, TSC, Ruff, Mypy, goimports, Trivy).
        *   `workspace.ts`: Git operations (clone, branch, push) and directory management.
    *   `infra/`
        *   `linear-client.ts`: Linear SDK wrapper.
        *   `plan-store.ts`: Redis-based plan persistence.
        *   `webhook-schemas.ts`: Zod schemas for parsing Linear payloads.
        *   `logger.ts`: Pino structured logging singleton.
    *   `security/`: PII and secret redaction middleware.
*   `tests/`: Bun test files mirroring the `src/` structure.
*   `infra/`: Terraform configurations for GCP (GKE, VPC, Redis, IAM).
*   `helm/`: Helm charts for Kubernetes deployment.
*   `.github/workflows/`: CI/CD pipelines.

## Critical Conventions & Guidelines

### Security (STRICT)
*   **Command Execution:** `src/agent/tools.ts` implements a strict **allowlist** for shell commands. NEVER bypass this. Allowed: `npm`, `git`, `ls`, `cat`, `pytest`, `ruff`, etc. Blocked: `rm`, `curl |`, `> /dev/`.
*   **File Access:** All file operations must be sandboxed within the ephemeral workspace. Path traversal checks are mandatory.
*   **Webhooks:** Always verify the Linear HMAC signature (`linear-signature` header) in the API.

### Coding Standards
*   **TypeScript:** Use strict typing. Follow existing patterns.
*   **Async/Await:** Use modern async patterns.
*   **Logging:** Use `logger` from `src/infra/logger.ts` (Pino). No `console.log` in `src/`.
*   **Error Handling:** Ensure errors are caught and logged, but allow the worker to retry transient failures.

### Testing
*   **Mocking:** Heavy reliance on mocking external services (Anthropic, Redis, simple-git, child_process) using `mock.module()` from `bun:test`.
*   **Isolation:** Tests should not depend on actual external APIs or persistent state.

### Infrastructure
*   **Secrets:** Managed via GCP Secret Manager and synced to K8s via External Secrets Operator.
*   **Deployment:** Infrastructure is defined in Terraform (`infra/`). Application deployment is via Helm (`helm/`).
