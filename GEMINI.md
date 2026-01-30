# Ralph Platform - AI Coding Agent

Ralph is an event-driven AI coding agent platform that automates software development tasks. It processes Linear issues, utilizes Claude AI (Sonnet 4.5 for planning and execution with budget limits, Haiku 4.5 for error summarization) to generate code, validates changes using polyglot toolchains, and pushes pull requests to GitHub.

## Project Overview

*   **Type:** TypeScript / Node.js Application
*   **Architecture:** Event-driven microservices (API + Worker) backed by Redis.
*   **Infrastructure:** Kubernetes (GKE), Terraform, Helm.
*   **AI Models:** Anthropic Claude (Sonnet 4.5 for planning & coding, Haiku 4.5 for error summarization).

## Architecture & Data Flow

1.  **Trigger:** A Linear issue with the label `Ralph` triggers a webhook.
2.  **API Service (`src/server.ts`):** Receives the webhook, validates the HMAC signature, and enqueues the task into Redis (BullMQ).
3.  **Worker Service (`src/worker.ts`):** Dequeues the task and initializes the Agent.
4.  **Agent (`src/agent.ts`):**
    *   **Workspace:** Clones the target repository into an ephemeral directory (`/tmp/ralph-workspaces`).
    *   **Planning:** Uses Claude Sonnet 4.5 to create an implementation plan ($0.50 budget limit).
    *   **Coding:** Uses Claude Sonnet to generate code based on the plan.
    *   **Validation:** Runs language-specific tools (Biome, TSC, Ruff, Mypy) via `src/tools.ts`.
5.  **Output:** Commits changes and pushes a new branch/PR to GitHub.
6.  **Observability:** Execution traces are sent to Langfuse.

## Development Workflow

### Prerequisites
*   Node.js (v20+)
*   Docker & Docker Compose
*   Redis (local or via Docker)

### Installation
```bash
npm install
```

### Build
Compile TypeScript to `dist/`:
```bash
npm run build
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
npm run start:api

# Terminal 2: Worker
npm run start:worker
```

### Testing
The project uses Jest for testing.
```bash
# Run all tests
npm test

# Run a specific test file
NODE_OPTIONS=--experimental-vm-modules npx jest tests/server.test.ts

# Run in watch mode
NODE_OPTIONS=--experimental-vm-modules npx jest --watch
```

## Project Structure

*   `src/`
    *   `server.ts`: API entry point. Handles webhooks and queuing.
    *   `worker.ts`: Worker entry point. Processes jobs from Redis.
    *   `agent.ts`: Core AI logic (Planning -> Coding loop).
    *   `tools.ts`: Tool definitions for the AI (file ops, command execution, validation).
    *   `workspace.ts`: Git operations (clone, branch, push) and directory management.
*   `tests/`: Jest test files mirroring the `src/` structure.
*   `infra/`: Terraform configurations for GCP (GKE, VPC, Redis, IAM).
*   `helm/`: Helm charts for Kubernetes deployment.
*   `.github/workflows/`: CI/CD pipelines.

## Critical Conventions & Guidelines

### Security (STRICT)
*   **Command Execution:** `src/tools.ts` implements a strict **allowlist** for shell commands. NEVER bypass this. Allowed: `npm`, `git`, `ls`, `cat`, `pytest`, `ruff`, etc. Blocked: `rm`, `curl |`, `> /dev/`.
*   **File Access:** All file operations must be sandboxed within the ephemeral workspace. Path traversal checks are mandatory.
*   **Webhooks:** Always verify the Linear HMAC signature (`linear-signature` header) in the API.

### Coding Standards
*   **TypeScript:** Use strict typing. Follow existing patterns.
*   **Async/Await:** Use modern async patterns.
*   **Error Handling:** Ensure errors are caught and logged (or traced via Langfuse), but allow the worker to retry transient failures.

### Testing
*   **Mocking:** Heavy reliance on mocking external services (Anthropic, Redis, simple-git, child_process) using `jest.mock`.
*   **Isolation:** Tests should not depend on actual external APIs or persistent state.

### Infrastructure
*   **Secrets:** Managed via GCP Secret Manager and synced to K8s via External Secrets Operator.
*   **Deployment:** Infrastructure is defined in Terraform (`infra/`). Application deployment is via Helm (`helm/`).
