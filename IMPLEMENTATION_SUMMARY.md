# Human-in-the-Loop Planning - Implementation Summary

## Overview
Successfully implemented interactive planning with human steering for the Ralph Platform. This feature introduces a "plan-review" stage between Planning and Execution phases, allowing developers to approve or iterate on Ralph's implementation plans before code modifications begin.

## Files Created

### New Modules
1. **src/plan-store.ts** - Redis-based plan persistence
   - `storePlan()` - Save plans with 7-day TTL
   - `getPlan()` - Retrieve stored plans
   - `updatePlanStatus()` - Update plan status
   - `appendFeedback()` - Add human feedback
   - `deletePlan()` - Cleanup after execution

2. **src/linear-client.ts** - Linear API integration
   - `postComment()` - Post plans to Linear issues
   - `updateIssueState()` - Move issues between states
   - `getIssueState()` - Get current issue state
   - Includes state synonym mapping for "plan-review"

3. **src/plan-formatter.ts** - Plan formatting utility
   - Converts Opus XML plans to readable Markdown
   - Includes approval instructions
   - Formats for Linear display

### Test Files
1. **tests/plan-store.test.ts** - Plan persistence tests (6 tests)
2. **tests/linear-client.test.ts** - Linear integration tests (6 tests)
3. **tests/plan-formatter.test.ts** - Formatting tests (3 tests)
4. **tests/server.test.ts** - Extended with comment webhook tests (6 new tests)
5. **tests/worker.test.ts** - Updated for new job modes
6. **tests/agent.test.ts** - Updated for plan review mode

## Files Modified

### Core Modules
1. **src/agent.ts**
   - Added `StoredPlan` interface with feedback history
   - Extended `Task` interface with mode/plan fields
   - Refactored `runAgent()` to support three modes:
     - `plan-only`: Generate plan, post to Linear, store in Redis
     - `execute-only`: Execute approved plan from Redis
     - `full`: Legacy behavior (plan + execute)
   - Added `handlePlanOnlyMode()` helper
   - Added `handleExecuteOnlyMode()` helper
   - Updated state synonyms to include "plan-review"

2. **src/server.ts**
   - Added comment webhook handler
   - Implements approval pattern detection (LGTM, approved, proceed, ship it)
   - Enqueues execution jobs on approval
   - Enqueues re-planning jobs on feedback
   - Only processes comments on issues in "plan-review" state

3. **src/worker.ts**
   - Added Redis connection for passing to agent
   - Extended job data handling with mode/plan fields
   - Passes Redis connection to runAgent

### Configuration
4. **.env.example**
   - Added `LINEAR_API_KEY` (required for plan review)
   - Added `PLAN_REVIEW_ENABLED` (default: true)
   - Added `PLAN_TTL_DAYS` (default: 7)

### Documentation
5. **CLAUDE.md**
   - Added "Human-in-the-Loop Planning" section
   - Updated Architecture Flow with plan review workflow
   - Added state transition diagram
   - Documented approval commands
   - Updated environment setup section
   - Added webhook handling details

## Architecture

### State Flow
```
Todo → Plan Review → In Progress → In Review → Done
         ↑____________↓
      (revision loop)
```

### Webhook Processing
1. **Issue Created/Updated** → Plan-only job (if PLAN_REVIEW_ENABLED=true)
2. **Comment on Plan-Review Issue**:
   - Approval phrase → Execute-only job
   - Other text → Re-planning job with feedback

### Data Flow
1. Opus generates plan → Store in Redis
2. Post formatted plan to Linear
3. Human reviews → Comments on issue
4. Webhook processes comment → Enqueue appropriate job
5. On execution complete → Delete plan from Redis

## Configuration

### Environment Variables
- `PLAN_REVIEW_ENABLED` - Toggle feature (default: true)
- `PLAN_TTL_DAYS` - Redis plan TTL (default: 7 days)
- `LINEAR_API_KEY` - Required for posting comments (write access)

### Approval Commands (case-insensitive)
- `lgtm`
- `approved`
- `proceed`
- `ship it`

## Test Coverage

### Test Suite Results
- **8 test suites** (all passing)
- **52 tests** (all passing)
- Coverage: 74% statements, 59% branches

### New Test Coverage
- Plan storage and retrieval with TTL
- Feedback accumulation
- Comment webhook processing
- Approval pattern detection
- State filtering for plan-review
- Job mode handling

## Backwards Compatibility

The implementation maintains full backwards compatibility:
- Setting `PLAN_REVIEW_ENABLED=false` reverts to legacy behavior
- Default task mode is `full` for legacy workflows
- Existing tests updated to work with new signatures
- No breaking changes to existing APIs

## Security Considerations

1. **Webhook Verification**: Comment webhooks use same HMAC SHA-256 verification
2. **State Validation**: Only processes comments on issues in plan-review state
3. **Plan TTL**: Automatic cleanup prevents orphaned plans
4. **No Arbitrary Code**: Comment parsing only triggers predefined actions

## Future Enhancements (Not Implemented)

- Web UI for plan visualization
- Plan diff view for revisions
- Multiple approval threshold
- Plan versioning history
- Metrics/analytics on approval rates
