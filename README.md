# Ralph - AI Coding Agent Platform

Ralph is an event-driven AI coding agent that automatically processes Linear issues, generates implementation plans, validates code with polyglot toolchains, and creates pull requests on GitHub.

## 🎯 What is Ralph?

Ralph automates the software development workflow by:
- **Planning** with Claude Opus 4.6 (implementation plans)
- **Coding** with Claude Opus 4.6 (code execution)
- **Error Summarization** with Claude Haiku 4.5 (lightweight failure analysis)
- **Validating** with polyglot tools (Biome, TSC, Ruff, Mypy, goimports, staticcheck, terraform, tflint, Trivy)
- **Iterating** based on human feedback and CI results

## ✨ Key Features

- **Human-in-the-Loop Planning** - Review and approve implementation plans before code execution
- **PR Iteration Workflow** - Continuously improve PRs with CI/SonarQube feedback
- **Multi-Repository Support** - Map Linear teams to different GitHub repositories
- **Polyglot Validation** - Auto-detect and validate TypeScript, JavaScript, Python, Go, and Terraform projects
- **Flat-Rate Auth** - Claude Max account pool with automatic rotation on rate-limit, no per-token billing
- **Token-Efficient** - Haiku for summaries, TOON format for token reduction
- **Security-First** - Command allowlists, sandbox isolation, secret scanning
- **Observable** - Full tracing with Langfuse

## 🛡️ Infrastructure-Grade Safety

Unlike toy agents, Ralph is built with infrastructure primitives for production environments:

- **Atomic Locking** - Distributed locks via Redis (BullMQ) ensure no race conditions during long-running LLM tasks.
- **Input Redaction** - Deterministic PII and Secret redaction middleware filters all I/O *before* it reaches the LLM.
- **Immutable Workflows** - Redis-based "Tombstone" locks prevent zombie tasks and accidental re-processing of completed issues.
- **Graceful Lifecycle** - Full SIGTERM/SIGINT handling ensures workers finish active jobs before shutdown, crucial for K8s stability.
- **Ephemeral Workspaces** - Strict UUID-based directory isolation for every job.
- **Claude Code Sandbox** - All agent tool execution runs through Claude CLI's built-in security model.

## 🚀 Quick Start

### Local Development

```bash
# Clone and setup
git clone https://github.com/Replikanti/ralph-platform.git
cd ralph-platform
cp .env.example .env
# Edit .env with your API keys

# Start the stack (requires Docker)
docker-compose up --build

# Run tests (requires Bun)
npm test
```

For local webhook testing, use [ngrok](https://ngrok.com/): `ngrok http 3000`

### Production Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete GCP/Kubernetes setup with Terraform.

## 📚 Documentation

| Document | Description |
|----------|-------------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Technical architecture, components, workflow diagrams |
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | GCP deployment, Terraform, Kubernetes, infrastructure |
| **[USER_GUIDE.md](./USER_GUIDE.md)** | How to use Ralph, workflows, examples |
| **[CLAUDE.md](./CLAUDE.md)** | Instructions for Claude Code when working on Ralph's codebase |

## 🔄 Workflows

Ralph supports three distinct workflows:

### 1. Human-in-the-Loop Planning (Default)
```
Create Linear Issue → Ralph Plans → Human Reviews → Approves → Ralph Implements → Creates PR
```

### 2. PR Iteration Workflow
```
PR Created → CI Fails → Comment Feedback → Ralph Plans Fix → Approves → Pushes to Same PR
```

### 3. Legacy Mode (Plan + Execute)
```
Create Linear Issue → Ralph Plans + Implements → Creates PR
```

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for detailed workflow diagrams.

## 🎮 Basic Usage

### 1. Create a Linear Issue

- Add label: **"Ralph"**
- Write clear description of the task
- Ralph automatically starts working

### 2. Review the Plan

- Ralph posts implementation plan as comment
- Issue moves to **"Todo"** state (awaiting your approval)
- Reply with:
  - **"LGTM"** / **"approved"** / **"proceed"** → Ralph implements
  - **Feedback** → Ralph revises plan
- When you comment, issue automatically moves back to **"In Progress"**

### 3. Iterate on PR (Optional)

- After PR creation, comment on ticket with improvements
- Examples: "fix CI errors", "refactor per SonarQube"
- Ralph creates iteration plan → approve → pushes fix

See **[USER_GUIDE.md](./USER_GUIDE.md)** for complete examples and best practices.

## 🛠️ Development

```bash
# Build
bun run build

# Run all tests
npm test

# Run a specific test file
bun test tests/server.test.ts

# Start services
bun run src/platform/server.ts    # API on port 3000
bun run src/platform/worker.ts    # Background worker
```

## 🔐 Environment Variables

```bash
# Required
REDIS_URL=redis://localhost:6379
GITHUB_TOKEN=ghp_xxx                    # Requires 'repo' scope
LINEAR_WEBHOOK_SECRET=xxx               # From Linear webhook settings

# Claude Max flat-rate auth
CLAUDE_ACCOUNTS_DIR=/claude-accounts    # Dir with account subdirs (each has .credentials.json)
CLAUDE_RATE_LIMIT_TTL_MINUTES=60        # Fallback block TTL when rate-limited (default: 60)

# Required for Plan Review
LINEAR_API_KEY=lin_api_xxx              # Write access to Linear

# Optional
PLAN_REVIEW_ENABLED=true                # Enable human-in-the-loop (default: true)
PLAN_TTL_DAYS=7                         # Redis plan TTL (default: 7)
LOG_LEVEL=info                          # Pino log level: debug|info|warn|error
WORKSPACE_ROOT=/tmp/ralph-workspaces    # Override workspace directory
LANGFUSE_SECRET_KEY=sk-lf-xxx           # Observability
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_HOST=https://cloud.langfuse.com
DEFAULT_REPO_URL=https://github.com/org/repo  # Fallback repo

# BAML proxy (set automatically by worker, override only if needed)
BAML_PROXY_PORT=3001                        # Port for BAML proxy server
BAML_PROXY_URL=http://localhost:3001/v1     # URL for BAML clients

# For multi-repo setup, use Helm values.yaml (see DEPLOYMENT.md)
```

## 🏗️ Architecture Overview

```mermaid
graph LR
    Linear[Linear Webhook] -->|POST| API[API Server]
    API -->|Enqueue| Redis[(Redis)]
    Redis -->|Dequeue| Worker[Worker]
    Worker -->|Plan + Code| Opus[Claude Opus 4.6]
    Worker -->|Summarize| Haiku[Claude Haiku 4.5]
    Worker -->|Validate| Tools[Polyglot Tools]
    Worker -->|Push| GitHub[GitHub PR]
    Worker -->|Trace| Langfuse[Langfuse]
    Accounts[/claude-accounts/] -->|Credentials| Worker
```

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for detailed component architecture.

## 🔒 Security

Ralph implements multiple security layers:

- **Claude Code Sandbox** - Agent tool execution via Claude CLI's built-in security model
- **Sandbox Isolation** - Each task runs in isolated UUID workspace
- **Secret Scanning** - Trivy scans for exposed secrets
- **Webhook Authentication** - HMAC SHA-256 signature verification
- **Resource Limits** - Timeout, memory, and output size limits

⚠️ **Important**: Ralph can execute code from `package.json` scripts and Python test configs. Only use with trusted repositories. See **[ARCHITECTURE.md](./ARCHITECTURE.md#security)** for detailed security model.

## 📊 Monitoring

Ralph integrates with:

- **BullMQ Dashboard** - Queue monitoring at `/admin/queues`
- **Langfuse** - Full LLM observability and tracing
- **Kubernetes Metrics** - Resource usage and health checks

## 🤝 Contributing

Ralph is **self-evolving**. When adding features or fixing bugs in Ralph's own codebase, Ralph is authorized to modify `src/` files directly.

See **[CLAUDE.md](./CLAUDE.md)** for development guidelines.

## 📄 License

MIT

## 🔗 Links

- [GitHub Repository](https://github.com/Replikanti/ralph-platform)
- [Linear Integration Guide](./USER_GUIDE.md#linear-setup)
- [GCP Deployment Guide](./DEPLOYMENT.md)
- [Architecture Deep Dive](./ARCHITECTURE.md)
