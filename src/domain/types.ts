// src/domain/types.ts

/** Příchozí issue z Linear webhooks */
export interface WebhookIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  labels: Array<{ name: string }>;
  state?: { name: string };
  team?: { key: string };
}

/** Příchozí komentář z Linear webhooks */
export interface WebhookComment {
  id: string;
  body: string;
  author: { name?: string; displayName?: string };
  issue?: {
    id: string;
    title?: string;
    description?: string;
    state?: { name: string };
    team?: { key: string };
    identifier?: string;
  };
}

/** Uložený plán v Redisu (přeneseno z agent.ts) */
export interface StoredPlanContext {
  plan: string;
  taskContext: {
    ticketId: string;
    title: string;
    description?: string;
    repoUrl: string;
    branchName: string;
    isIteration?: boolean;
  };
  feedbackHistory: string[];
}

/** Výsledek AI agenta */
export type AgentResult =
  | { mode: 'plan-only'; status: 'plan-generated'; plan: string }
  | { mode: 'execute-only' | 'full'; status: 'executed'; prUrl: string | null; isIteration: boolean }
  | { mode: 'execute-only' | 'full'; status: 'no-changes' }
  | { mode: 'execute-only' | 'full'; status: 'validation-failed'; validationOutput: string; failureSummary: string };

/** Akce, kterou má platforma vykonat po výsledku agenta */
export type PlatformAction =
  | { type: 'store-plan-and-notify'; plan: string }
  | { type: 'mark-in-review'; prUrl: string | null; isIteration: boolean }
  | { type: 'mark-todo-no-changes' }
  | { type: 'mark-todo-failed'; summary: string; validationOutput: string };

/** Rozhodnutí o směrování příchozího komentáře */
export type CommentRouting =
  | { action: 'approve'; storedPlan: StoredPlanContext }
  | { action: 'revise'; storedPlan: StoredPlanContext; feedback: string }
  | { action: 'iterate'; issueId: string; issueTitle: string; issueDescription?: string; teamKey?: string; identifier?: string; feedback: string }
  | { action: 'ignore'; reason: 'ralph-comment' | 'no-stored-plan' | 'already-processed' };
