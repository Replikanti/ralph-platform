# Ralph - User Guide

Quick reference for using Ralph in your daily workflow.

## Quick Start

### 1. Create Linear Ticket

Create a new issue in Linear with:
- **Label**: `Ralph`
- **Title**: Clear, concise task description
- **Description**: Detailed requirements

Example:
```
Title: Add user authentication to login page
Description: 
- Implement JWT-based authentication
- Add login form with email/password
- Store token in localStorage
- Redirect to dashboard on success
```

### 2. Ralph Generates Plan

Ralph will:
1. Move ticket to "In Progress"
2. Generate implementation plan using Claude Sonnet 4.5 ($0.50 budget limit)
3. Post plan as comment
4. Move ticket to **"Todo"** state (awaiting your approval)

### 3. Review & Approve Plan

Review the posted plan and reply with:
- **Approve**: `LGTM`, `approved`, `proceed`, or `ship it`
- **Feedback**: Any other comment (e.g., "please add error handling")

**Note**: When you comment, the ticket automatically moves back to "In Progress" to indicate Ralph is processing your feedback.

### 4. Ralph Implements

After approval:
1. Moves ticket to "In Progress"
2. Implements code using Claude Sonnet 4.5 ($2.00 budget limit)
3. Runs validation (Biome, TSC, Ruff, Mypy, Trivy)
4. Creates pull request on GitHub
5. Waits 3 seconds for Linear auto-switch
6. Updates ticket to "In Review" (if Linear didn't auto-switch)

### 5. Iterate on PR (Optional)

If CI fails or you want improvements:
1. Comment on Linear ticket (still in "In Review")
2. Example: `fix failing tests` or `refactor per SonarQube`
3. Ralph creates iteration plan → approve → pushes fix
4. Repeat as needed

## Workflows

See **[ARCHITECTURE.md](./ARCHITECTURE.md#workflows)** for detailed sequence diagrams.

### Standard Workflow

```
Create Issue → Plan → Approve → Implement → PR Created
```

### Iteration Workflow

```
PR Created → CI Fails → Comment Feedback → Plan Fix → Approve → Push to PR
```

## Linear Setup

### Required States

Ralph uses standard Linear workflow states:

| State | Purpose | When Used |
|-------|---------|-----------|
| `Todo` | Waiting for human plan approval | Ralph posts plan and moves ticket here |
| `In Progress` | Ralph is actively working | During planning, coding, and when processing feedback |
| `In Review` | PR created, awaiting merge | After PR is created on GitHub |
| `Done` | Task completed | After PR is merged (manual) |

**State Transitions**:
- When you comment on a ticket in "Todo", it automatically moves back to "In Progress"
- After PR creation, Linear may auto-switch to "In Review" (Ralph waits 3s and updates only if needed)

### Webhook Configuration

1. Go to **Linear → Settings → API → Webhooks**
2. Create webhook:
   - **URL**: `https://your-ralph-instance.com/webhook`
   - **Events**: Enable `Issues` (Create, Update) and `Comments` (Create)
   - **Secret**: Copy to `LINEAR_WEBHOOK_SECRET` env var

## Multi-Repository Setup

Ralph supports mapping Linear teams to different GitHub repositories using Helm chart configuration.

### Configuring Repository Mappings (Recommended)

Edit `helm/ralph/values.yaml`:

```yaml
teamRepos:
  FRONTEND: "https://github.com/org/frontend-repo"
  BACKEND: "https://github.com/org/backend-repo"
  INFRA: "https://github.com/org/infrastructure"
  MOBILE: "https://github.com/org/mobile-app"
```

Deploy changes:

```bash
cd helm/ralph
helm upgrade ralph . -n ralph
```

### How It Works

- **Issue in FRONTEND team** → clones `frontend-repo`
- **Issue in BACKEND team** → clones `backend-repo`
- **Unknown team** → uses `DEFAULT_REPO_URL` fallback (if configured)

### Configuration Flow

1. Helm renders `teamRepos` from `values.yaml`
2. Creates Kubernetes ConfigMap at `/etc/ralph/config/repos.json`
3. Ralph reads the file and caches mappings in Redis
4. Auto-reloads when ConfigMap changes (no pod restart needed)

### Legacy: Environment Variable (Not Recommended)

For backwards compatibility:

```yaml
# In values.yaml under env:
- name: LINEAR_TEAM_REPOS
  value: '{"TEAM":"https://github.com/org/repo"}'
```

⚠️ **Note**: Environment variables require pod restart on changes. Use `teamRepos` in values.yaml instead.

## Best Practices

### Writing Good Task Descriptions

**Good**:
```
Title: Add password reset functionality
Description:
- Add "Forgot Password" link to login page
- Send reset email with token
- Create reset password form
- Token expires after 1 hour
- Update password in database
```

**Bad**:
```
Title: Fix stuff
Description: make it work
```

### Plan Review Tips

**Be Specific**:
- ❌ "This doesn't look right"
- ✅ "Use bcrypt instead of plain SHA-256 for password hashing"

**Ask Questions**:
- "Should we add rate limiting to prevent brute force?"
- "Do we need to log failed authentication attempts?"

**Iterate**:
- Don't approve if you're unsure
- Request clarifications
- Ralph will revise the plan

### PR Iteration Examples

**CI Failures**:
```
"fix the failing unit tests in auth.test.ts"
"resolve TypeScript errors in LoginForm component"
```

**Code Quality**:
```
"refactor LoginHandler according to SonarQube suggestions"
"reduce cognitive complexity in validatePassword function"
"remove code duplication in error handlers"
```

**Improvements**:
```
"add JSDoc comments to public methods"
"improve error messages for better UX"
"add loading state to login button"
```

## Troubleshooting

### Ralph Doesn't Respond

**Check**:
1. Issue has "Ralph" label
2. Webhook is configured in Linear
3. API logs: `kubectl logs -l app=ralph-api`
4. Worker logs: `kubectl logs -l app=ralph-worker`

### Plan Not Posted

**Check**:
1. `LINEAR_API_KEY` is set
2. API key has write permissions
3. Network connectivity to Linear API

### Comment Ignored

**Possible Reasons**:
1. **Ralph's own comment**: Ralph filters his own comments to prevent auto-execution
2. **No stored plan**: For plan approval, a plan must exist in Redis
3. **Wrong state**: For PR iteration, ticket should be in review-like state

**Check Stored Plan**:
```bash
# Connect to Redis
kubectl exec -it redis-pod -- redis-cli

# Check if plan exists
GET ralph:plan:{issue-id}
```

### Validation Failures

Ralph pushes code even if validation fails (with `wip:` prefix).

**Check PR**:
- Look for validation errors in PR description
- Fix manually or ask Ralph to iterate

## Advanced Usage

### Disable Plan Review

For auto-execution without approval:

```bash
# In .env
PLAN_REVIEW_ENABLED=false
```

Ralph will plan + implement in one go (legacy mode).

### Custom Plan TTL

```bash
# In .env
PLAN_TTL_DAYS=14  # Default: 7
```

Plans stored longer allow for delayed approvals.

### Monitor Queue

Access BullMQ dashboard:
```
https://your-ralph-instance.com/admin/queues
```

Credentials: `ADMIN_USER` and `ADMIN_PASS` from env vars.

## Examples

### Example 1: Simple Feature

```
Linear Issue:
  Title: Add dark mode toggle
  Label: Ralph
  Description: Add a toggle button in navbar to switch between light and dark themes

Ralph's Plan:
  1. Add theme context provider
  2. Create toggle component
  3. Store preference in localStorage
  4. Apply theme classes to body

You: "LGTM"

Ralph: Creates PR with implementation
```

### Example 2: Fix with Iteration

```
Linear Issue:
  Title: Fix broken search functionality
  Label: Ralph

Ralph: Creates PR #42

CI: ❌ Tests failing

You: "fix the failing search tests"

Ralph: Posts iteration plan
  1. Review test failures
  2. Fix debounce timing in search
  3. Update test mocks

You: "approved"

Ralph: Pushes fix to PR #42

CI: ✅ Passing
```

### Example 3: Code Quality Iteration

```
Ralph: Creates PR #43

SonarQube: ⚠️ Code smell - high complexity

You: "reduce complexity in processOrder function as suggested by SonarQube"

Ralph: Posts refactoring plan
  1. Extract validation logic to separate function
  2. Use early returns instead of nested ifs
  3. Break down into smaller helpers

You: "ship it"

Ralph: Refactors and pushes to PR #43

SonarQube: ✅ All clear
```

---

For technical details, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.
For deployment, see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.
