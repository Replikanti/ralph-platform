# Quick Start: Human-in-the-Loop Planning

## Setup (Required)

1. **Add to your `.env` file:**
```bash
# Required for plan review
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx

# Optional - disable if you want legacy behavior (plan + execute in one go)
PLAN_REVIEW_ENABLED=true

# Optional - change plan storage duration
PLAN_TTL_DAYS=7
```

2. **Linear states** — Ralph uses standard Linear workflow states. No custom states required:
   - `Todo` — awaiting human plan approval
   - `In Progress` — Ralph is actively working
   - `In Review` — PR created, awaiting merge
   - `Done` — task completed

## Usage

### Creating a Task
1. Create a Linear issue as normal
2. Add the **"Ralph"** label
3. Ralph will:
   - Move issue to "In Progress"
   - Generate an implementation plan
   - Post it as a comment
   - Move issue to **"Todo"** state (awaiting your approval)

### Approving a Plan
Comment on the issue with any of:
- `LGTM`
- `approved`
- `proceed`
- `ship it`

When you comment, the issue automatically moves back to "In Progress". Ralph will execute the approved plan and create a PR.

### Requesting Changes
Comment with your feedback, e.g.:
- "Please add more error handling"
- "Can we use a different approach for X?"

Ralph will:
- Incorporate your feedback
- Generate a revised plan
- Post it as a new comment
- Move issue back to "Todo" (awaiting approval again)

### State Flow
```
New Issue
  ↓
In Progress  (Ralph planning)
  ↓
Todo         (awaiting your approval)
  ↓
In Progress  (Ralph executing — triggered by your comment)
  ↓
In Review    (PR created)
  ↓
Done         (PR merged — manual)
```

## Disabling Plan Review

To revert to legacy behavior (plan + execute in one go):

```bash
PLAN_REVIEW_ENABLED=false
```

## Troubleshooting

**Plan not posted to Linear:**
- Check that `LINEAR_API_KEY` is set
- Verify the key has write permissions
- Check logs for Linear API errors

**Comments not triggering execution:**
- Ensure a stored plan exists in Redis (TTL is 7 days by default)
- Verify webhook signature is valid
- Check that the comment is not from Ralph itself (Ralph's own comments are filtered to prevent loops)

**Want to skip plan review for a specific issue:**
- Set `PLAN_REVIEW_ENABLED=false` temporarily
- Or manually move the issue to "In Progress" before commenting
