import type { WebhookComment, WebhookIssue, CommentRouting, StoredPlanContext } from './types';

/** Schválení plánu uživatelem */
export function isApprovalComment(body: string): boolean {
  const patterns = [/\blgtm\b/i, /\bapproved\b/i, /\bproceed\b/i, /\bship it\b/i];
  return patterns.some(p => p.test(body));
}

/** Má být issue webhook ignorován? */
export function shouldSkipIssueWebhook(action: string, stateName: string): boolean {
  if (action !== 'update') return false;
  const terminal = ['in progress', 'in review', 'completed', 'canceled', 'done'];
  return terminal.includes(stateName.toLowerCase().trim());
}

/** Má issue Ralph label? */
export function hasRalphLabel(issue: WebhookIssue): boolean {
  return issue.labels.some(l => l.name.toLowerCase() === 'ralph');
}

/** Je komentář od Ralpha samotného? (zabraňuje auto-execution smyčce) */
export function isRalphOwnComment(comment: WebhookComment): boolean {
  const author = (comment.author.name ?? comment.author.displayName ?? '').toLowerCase();
  return (
    author.includes('ralph') ||
    author.includes('bot') ||
    comment.body.includes('🤖 Ralph') ||
    comment.body.includes("Ralph's Implementation Plan")
  );
}

/** Je issue v "In Review" stavu? */
export function isInReviewState(stateName: string): boolean {
  return stateName.toLowerCase().includes('review');
}

/** Je issue v aktivním stavu (schválení by bylo duplicitní)? */
export function isAlreadyProcessing(stateName: string): boolean {
  const normalized = stateName.toLowerCase();
  return normalized === 'in progress' || normalized === 'in review';
}

/**
 * Hlavní routing funkce pro komentář webhook.
 * Vrací čisté rozhodnutí — žádné side effecty.
 */
export function routeComment(
  comment: WebhookComment,
  storedPlan: StoredPlanContext | null,
): CommentRouting {
  if (isRalphOwnComment(comment)) {
    return { action: 'ignore', reason: 'ralph-comment' };
  }

  const issueStateName = comment.issue?.state?.name ?? '';

  if (storedPlan) {
    if (isApprovalComment(comment.body) && isAlreadyProcessing(issueStateName)) {
      return { action: 'ignore', reason: 'already-processed' };
    }
    if (isApprovalComment(comment.body)) {
      return { action: 'approve', storedPlan };
    }
    return { action: 'revise', storedPlan, feedback: comment.body };
  }

  if (isInReviewState(issueStateName) && comment.issue?.id) {
    return {
      action: 'iterate',
      issueId: comment.issue.id,
      issueTitle: comment.issue.title ?? 'Iterative fix',
      issueDescription: comment.issue.description,
      teamKey: comment.issue.team?.key,
      identifier: comment.issue.identifier,
      feedback: comment.body,
    };
  }

  return { action: 'ignore', reason: 'no-stored-plan' };
}
