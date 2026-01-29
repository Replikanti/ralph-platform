# Quick Start: Human-in-the-Loop Planning

## Setup (Required)

1. **Add to your `.env` file:**
```bash
# Required for plan review
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx

# Optional - disable if you want old behavior
PLAN_REVIEW_ENABLED=true

# Optional - change plan storage duration
PLAN_TTL_DAYS=7
```

2. **Create "plan-review" state in Linear:**
   - Go to your Linear workspace settings
   - Navigate to States
   - Add a new state called "plan-review" (or use synonyms: "pending review", "awaiting approval")
   - Place it between "Todo" and "In Progress" in your workflow

## Usage

### Creating a Task
1. Create a Linear issue as normal
2. Add the "Ralph" label
3. Ralph will:
   - Generate an implementation plan
   - Post it as a comment
   - Move issue to "plan-review" state

### Approving a Plan
Comment on the issue with any of:
- `LGTM`
- `approved`
- `proceed`
- `ship it`

Ralph will execute the approved plan and create a PR.

### Requesting Changes
Comment with your feedback, e.g.:
- "Please add more error handling"
- "Can we use a different approach for X?"

Ralph will:
- Incorporate your feedback
- Generate a revised plan
- Post it as a new comment
- Keep issue in "plan-review" state

### State Flow
```
Todo 
  ↓
Plan Review (human approval needed)
  ↓
In Progress (Ralph executing)
  ↓
In Review (PR created)
  ↓
Done
```

## Disabling Plan Review

To revert to the old behavior (plan + execute in one go):

```bash
PLAN_REVIEW_ENABLED=false
```

## Troubleshooting

**Plan not posted to Linear:**
- Check that `LINEAR_API_KEY` is set
- Verify the key has write permissions
- Check logs for Linear API errors

**Comments not triggering execution:**
- Ensure issue is in "plan-review" state
- Check that plan exists in Redis (TTL is 7 days)
- Verify webhook signature is valid

**Want to skip plan review for specific issues:**
- Set `PLAN_REVIEW_ENABLED=false` temporarily
- Or manually move issue to "In Progress" before commenting
