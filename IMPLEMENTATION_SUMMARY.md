# Human-in-the-Loop Planning - Implementation Summary

## Overview
Successfully implemented interactive planning with human steering for the Ralph Platform. This feature introduces a review stage between Planning and Execution phases, allowing developers to approve or iterate on Ralph's implementation plans before code modifications begin.

## Recent Improvements (2026-01-30)

### 1. Auto-Execution Prevention
**Problem**: Ralph's plan comments contained approval keywords (LGTM, approved, proceed, ship it) in the instructions. When Ralph posted a plan, Linear sent a webhook for Ralph's own comment, which the handler detected as approval and immediately executed without human review.

**Solution**: Implemented comment filtering in `src/server.ts`:
- Detect Ralph's comments by author name (contains "ralph" or "bot")
- Detect Ralph's comment patterns ("🤖 Ralph", "Ralph's Implementation Plan")
- Filter these comments entirely to prevent webhook loops
- Added test coverage for this critical security feature

### 2. State Management UX Improvements
**Problem**: Used non-existent "plan-review" state that doesn't exist in standard Linear workspaces. Users couldn't filter tickets needing approval.

**Solution**: Use standard Linear states with clear semantics:
- **"Todo"**: Plan awaiting human approval (users can filter for tickets needing action)
- **"In Progress"**: Ralph actively working (planning, coding, processing feedback)
- **"In Review"**: PR created, awaiting merge
- When user comments on a "Todo" ticket, it automatically moves back to "In Progress"

### 3. PR Creation Race Condition Fix
**Problem**: Ralph updated Linear state to "In Review" before creating the PR. Linear auto-switches state based on PR presence, causing a race condition where tickets ended up in wrong state.

**Solution**: Reversed PR creation order in `src/agent.ts`:
1. Create PR on GitHub first
2. Wait 3 seconds for Linear's automatic state switch
3. Check if Linear auto-switched to "In Review"
4. Only manually update state if Linear didn't auto-switch
5. If auto-switched, just post comment (no state update needed)

This prevents the race condition and respects Linear's built-in automation.

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
   - Includes state synonym mapping for standard Linear states

3. **src/plan-formatter.ts** - Plan formatting utility
   - Converts Sonnet 4.5 XML plans to readable Markdown
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
     - `plan-only`: Generate plan, post to Linear, store in Redis, move to "Todo"
     - `execute-only`: Execute approved plan from Redis
     - `full`: Legacy behavior (plan + execute)
   - Added `handlePlanOnlyMode()` helper
   - Added `handleExecuteOnlyMode()` helper
   - **PR creation race condition fix**: Create PR → wait 3s → conditionally update state
   - Added `handlePRCreationAndStateUpdate()` helper for reversed order logic

2. **src/server.ts**
   - Added comment webhook handler
   - **Critical security**: Filters Ralph's own comments to prevent auto-execution
   - Implements approval pattern detection (LGTM, approved, proceed, ship it)
   - Moves ticket to "In Progress" when user comments (from "Todo")
   - Enqueues execution jobs on approval
   - Enqueues re-planning jobs on feedback
   - Handles PR iteration workflow (comments on "In Review" issues without stored plan)

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
Todo (awaiting approval) → In Progress (planning/executing) → In Review (PR created) → Done
         ↑_____________________________↓ (user comments with feedback)
                     (revision loop)
```

### Webhook Processing
1. **Issue Created/Updated** → Plan-only job (if PLAN_REVIEW_ENABLED=true) → moves to "Todo"
2. **Comment on Issue**:
   - **Filter Ralph's own comments** (prevents auto-execution)
   - If stored plan exists:
     - Approval phrase → Move to "In Progress" → Execute-only job
     - Other text → Move to "In Progress" → Re-planning job with feedback
   - If no stored plan + "In Review" state → PR iteration job

### Data Flow
1. Sonnet 4.5 generates plan → Store in Redis
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
- **Ralph comment filtering** (prevents auto-execution)
- State management with "Todo" state
- Job mode handling
- PR creation with Linear auto-switch wait logic

## Backwards Compatibility

The implementation maintains full backwards compatibility:
- Setting `PLAN_REVIEW_ENABLED=false` reverts to legacy behavior
- Default task mode is `full` for legacy workflows
- Existing tests updated to work with new signatures
- No breaking changes to existing APIs

## Security Considerations

1. **Webhook Verification**: Comment webhooks use same HMAC SHA-256 verification
2. **Comment Filtering**: **Critical** - Ralph's own comments are filtered to prevent auto-execution loops
3. **State Validation**: Comments processed based on stored plan existence and issue state
4. **Plan TTL**: Automatic cleanup prevents orphaned plans
5. **No Arbitrary Code**: Comment parsing only triggers predefined actions
6. **Race Condition Prevention**: PR created before state update to prevent tickets in wrong state

## Future Enhancements (Not Implemented)

- Web UI for plan visualization
- Plan diff view for revisions
- Multiple approval threshold
- Plan versioning history
- Metrics/analytics on approval rates
