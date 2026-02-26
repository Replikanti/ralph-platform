// src/domain/agent-outcomes.ts
import type { AgentResult, PlatformAction } from './types';

/**
 * Určí, co má platforma udělat po dokončení agenta.
 * Čistá funkce — žádné side effecty.
 */
export function resolvePlatformAction(result: AgentResult): PlatformAction {
  if (result.status === 'plan-generated') {
    return { type: 'store-plan-and-notify', plan: result.plan };
  }

  if (result.status === 'executed') {
    return { type: 'mark-in-review', prUrl: result.prUrl, isIteration: result.isIteration };
  }

  if (result.status === 'no-changes') {
    return { type: 'mark-todo-no-changes' };
  }

  // validation-failed
  return {
    type: 'mark-todo-failed',
    summary: result.failureSummary,
    validationOutput: result.validationOutput,
  };
}
