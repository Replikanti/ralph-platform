import { describe, it, expect } from '@jest/globals';
import { resolvePlatformAction } from '../../src/domain/agent-outcomes';
import { AgentResult } from '../../src/domain/types';

describe('agent-outcomes', () => {
  describe('resolvePlatformAction', () => {
    it('handles plan-generated status', () => {
      const result: AgentResult = { mode: 'plan-only', status: 'plan-generated', plan: 'my plan' };
      const action = resolvePlatformAction(result);
      expect(action).toEqual({ type: 'store-plan-and-notify', plan: 'my plan' });
    });

    it('handles executed status', () => {
      const result: AgentResult = { mode: 'full', status: 'executed', prUrl: 'https://github.com/org/repo/pull/1', isIteration: false };
      const action = resolvePlatformAction(result);
      expect(action).toEqual({ type: 'mark-in-review', prUrl: 'https://github.com/org/repo/pull/1', isIteration: false });
    });

    it('handles executed status for iteration', () => {
      const result: AgentResult = { mode: 'execute-only', status: 'executed', prUrl: 'https://github.com/org/repo/pull/1', isIteration: true };
      const action = resolvePlatformAction(result);
      expect(action).toEqual({ type: 'mark-in-review', prUrl: 'https://github.com/org/repo/pull/1', isIteration: true });
    });

    it('handles no-changes status', () => {
      const result: AgentResult = { mode: 'full', status: 'no-changes' };
      const action = resolvePlatformAction(result);
      expect(action).toEqual({ type: 'mark-todo-no-changes' });
    });

    it('handles validation-failed status', () => {
      const result: AgentResult = {
        mode: 'full',
        status: 'validation-failed',
        validationOutput: 'errors',
        failureSummary: 'it failed'
      };
      const action = resolvePlatformAction(result);
      expect(action).toEqual({
        type: 'mark-todo-failed',
        summary: 'it failed',
        validationOutput: 'errors'
      });
    });
  });
});
