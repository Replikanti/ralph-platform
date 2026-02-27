# Ralph Platform — Refactoring Plan

> **STATUS: COMPLETE** — Všech 5 fází implementováno a mergováno (PR #166–171, 2026-02).
> Souborové cesty v textu níže odpovídají finální architektuře (`src/domain/`, `src/platform/`, `src/agent/`, `src/infra/`).

## Kontext a cíl

Ralph je event-driven AI coding agent platform. Webhook server přijímá události z Linearu, enqueues je do Redisu přes BullMQ, worker je zpracovává a spouští AI agenta (Claude CLI). Cílem tohoto refactoru je:

1. **Vytvořit domain vrstvu** — čisté byznys funkce bez závislostí na frameworku, snadná portovatelnost do Go.
2. **Oddělit platformu od agenta** — jasná hranice umožní budoucí přepis platformy (server + worker + queue) do Go, zatímco agent (AI loop) zůstane v TypeScriptu/Bunu navždy.
3. **Přidat Zod validaci** — nahradit defensive `data?.x?.y || fallback` vzory ve webhook handleru typovanými schema.
4. **Přidat Pino logging** — nahradit `console.log` strukturovanými JSON logy pro produkci na GKE.
5. **Migrovat na Bun runtime** — modernizovat tooling, odstranit `NODE_OPTIONS` hack.

**Zásada 1**: Byznys logika (pravidla domény) musí být v čistých funkcích bez závislostí na Express, BullMQ ani IORedis.
**Zásada 2**: Agent (src/agent.ts) nesmí volat Linear API, ukládat do Redisu ani znát BullMQ.

---

## Architektura po refaktoru

```
src/
├── domain/                  ← NOVÉ: čistá byznys logika, žádné frameworkové závislosti
│   ├── types.ts             ← sdílené doménové typy (WebhookIssue, WebhookComment, …)
│   ├── webhook-routing.ts   ← rozhodování: co dělat s příchozím webhookem
│   └── agent-outcomes.ts    ← rozhodování: co dělat s výsledkem agenta
├── platform/                ← infrastruktura (Express, BullMQ, Redis)
│   ├── server.ts            ← HTTP mechanika, Zod parsing, volá domain funkce
│   └── worker.ts            ← queue mechanika, volá domain funkce + agenta
├── agent/                   ← AI exekuce (Claude CLI, git, validace)
│   ├── agent.ts
│   ├── workspace.ts
│   └── tools.ts
└── infra/                   ← externí služby (wrappers)
    ├── linear-client.ts
    ├── plan-store.ts
    ├── plan-formatter.ts
    ├── linear-utils.ts
    ├── logger.ts            ← NOVÉ: Pino singleton
    └── webhook-schemas.ts   ← NOVÉ: Zod schémata
```

> **Poznámka k přesunu souborů**: Přesun do podsložek (`platform/`, `agent/`, `infra/`) je volitelný. Pokud tým preferuje ploché `src/`, stačí zachovat stávající umístění souborů a přidat pouze `src/domain/` jako novou složku. Logická hranice je důležitější než fyzické umístění.

---

## Závislostní graf a paralelizace

Fáze 0a musí být hotová jako první — vše ostatní na ní závisí. Po jejím dokončení mohou vývojáři pracovat paralelně.

```
Fáze 0a: domain/types.ts
    │
    ├── Dev A ──→ Fáze 0b: webhook-routing.ts
    │                   └──→ Fáze 1: boundary refactor
    │
    ├── Dev B ──→ Fáze 0c: agent-outcomes.ts
    │                   └──→ Fáze 1: boundary refactor
    │
    ├── Dev C ──→ Fáze 2: Zod (webhook-schemas.ts)
    │
    ├── Dev D ──→ Fáze 3: Pino (zcela nezávislá)
    │
    └── Dev E ──→ Fáze 4: Bun (provést jako poslední)
```

| Fáze | Závisí na | Může běžet paralelně s |
|------|-----------|------------------------|
| 0a: domain/types.ts | nic | — |
| 0b: webhook-routing.ts | 0a | 0c, 2, 3 |
| 0c: agent-outcomes.ts | 0a | 0b, 2, 3 |
| 1: boundary refactor | 0b + 0c | 2, 3 |
| 2: Zod | 0a | 0b, 0c, 1, 3 |
| 3: Pino | nic | vše |
| 4: Bun | 1, 2, 3 | — |

---

## Fáze 0a — Doménové typy: `src/domain/types.ts`

Tento soubor definuje sdílené TypeScript interfaces pro celou domain vrstvu. **Žádné závislosti na externích balíčcích.**

```typescript
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
```

**Acceptance criteria:**
- [ ] Soubor neimportuje nic z externích balíčků (žádné `bullmq`, `ioredis`, `express`)
- [ ] Exportuje všechny typy výše
- [ ] `AgentResult` je přesunut sem z `src/agent.ts` (agent.ts ho bude importovat)

---

## Fáze 0b — Webhook routing: `src/domain/webhook-routing.ts`

Obsahuje čistou byznys logiku pro rozhodování o webhookách. **Žádné side effecty, žádné async.**

```typescript
// src/domain/webhook-routing.ts
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

  if (isInReviewState(issueStateName)) {
    return {
      action: 'iterate',
      issueId: comment.issue?.id ?? '',
      issueTitle: comment.issue?.title ?? 'Iterative fix',
      issueDescription: comment.issue?.description,
      teamKey: comment.issue?.team?.key,
      identifier: comment.issue?.identifier,
      feedback: comment.body,
    };
  }

  return { action: 'ignore', reason: 'no-stored-plan' };
}
```

**Acceptance criteria:**
- [ ] Žádné importy z `express`, `bullmq`, `ioredis`, `linear-client`
- [ ] Každá funkce je čistá (pure) — stejný vstup → stejný výstup, žádné side effecty
- [ ] Plné pokrytí unit testy v `tests/domain/webhook-routing.test.ts` — **bez jakéhokoli mockování**
- [ ] `shouldSkipIssueWebhook` pokrývá všechny terminal stavy
- [ ] `routeComment` pokrývá: Ralph komentář, schválení, revize, iterace, ignorace

---

## Fáze 0c — Agent outcomes: `src/domain/agent-outcomes.ts`

Mapuje výsledek agenta na konkrétní platformové akce. **Čistá funkce.**

```typescript
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
```

**Acceptance criteria:**
- [ ] Žádné importy z externích balíčků
- [ ] Unit testy v `tests/domain/agent-outcomes.test.ts` — **bez mockování**
- [ ] Pokrývá všechny větve `AgentResult`

---

## Fáze 0 — Testy domain vrstvy

Složka `tests/domain/` — všechny testy jsou čisté unit testy bez mocků:

```typescript
// tests/domain/webhook-routing.test.ts
import { describe, it, expect } from 'bun:test'; // nebo z '@jest/globals'
import { isApprovalComment, routeComment, shouldSkipIssueWebhook } from '../../src/domain/webhook-routing';

describe('isApprovalComment', () => {
  it('recognizes lgtm', () => expect(isApprovalComment('LGTM')).toBe(true));
  it('recognizes ship it', () => expect(isApprovalComment('ship it')).toBe(true));
  it('rejects regular feedback', () => expect(isApprovalComment('please fix the tests')).toBe(false));
});

// ... další testy pro každou exportovanou funkci
```

Tyto testy jsou triviální a rychlé — žádný spawn, žádný Redis, žádný HTTP.

---

## Fáze 1 — Boundary Refactor: Agent/Platform oddělení

### Proč

Aktuálně `src/agent.ts` přímo volá:
- `LinearClient.updateIssueState()`, `LinearClient.postComment()` — platformová odpovědnost
- `storePlan(redis, ...)`, `deletePlan(redis, ...)` — platformová odpovědnost

Toto porušuje hranici a znemožňuje budoucí Go migraci platformy.

### Krok 1.1 — Definovat `AgentResult` typ v `src/agent.ts`

Na začátek `src/agent.ts`, za existující `Task` a `StoredPlan` interfaces, přidat:

```typescript
export type AgentResult =
  | { mode: 'plan-only'; status: 'plan-generated'; plan: string }
  | { mode: 'execute-only' | 'full'; status: 'executed'; prUrl: string | null; isIteration: boolean }
  | { mode: 'execute-only' | 'full'; status: 'no-changes' }
  | { mode: 'execute-only' | 'full'; status: 'validation-failed'; validationOutput: string; failureSummary: string };
```

### Krok 1.2 — Odstranit Linear a Redis importy z `src/agent.ts`

**Odstranit** ze souboru:
```typescript
import IORedis from 'ioredis';
import { storePlan, deletePlan } from './plan-store';
import { formatPlanForLinear } from './plan-formatter';
import { LinearClient as RalphLinearClient } from './linear-client';
```

**Odstranit** export funkce `updateLinearIssue` — přesunout ji do `src/worker.ts` (viz Krok 1.5).

**Odstranit** parametr `redis?: IORedis` ze signatury `runAgent`.

### Krok 1.3 — Refaktorovat `handlePlanOnlyMode`

**Původní** `handlePlanOnlyMode` dělá:
1. Volá `linearClient.updateIssueState("In Progress")` — přesunout do worker.ts (před zavoláním agenta)
2. Volá `linearClient.postComment("Ralph is generating plan...")` — přesunout do worker.ts
3. Generuje plán — **zůstane v agentovi**
4. Volá `storePlan(redis, ...)` — přesunout do worker.ts
5. Volá `linearClient.postComment(formattedPlan)` — přesunout do worker.ts
6. Volá `linearClient.updateIssueState("Todo")` — přesunout do worker.ts

**Nová** funkce v agent.ts vrátí jen plán:

```typescript
async function handlePlanOnlyMode(
    task: Task,
    workDir: string,
    homeDir: string,
    trace: any,
    availableSkills: string,
): Promise<AgentResult> {
    const planSpan = trace.span({ name: "Planning-Sonnet-Plan-Review", metadata: { mode: 'plan-only' } });
    const previousErrors = task.additionalFeedback || "";
    const rawPlan = await planPhase(workDir, homeDir, task, availableSkills, previousErrors);
    const plan = rawPlan.replaceAll('<plan>', '').replaceAll('</plan>', '').trim();
    planSpan.end({ output: plan });

    return { mode: 'plan-only', status: 'plan-generated', plan };
}
```

### Krok 1.4 — Refaktorovat `handleExecuteOnlyMode`

**Původní** `handleExecuteOnlyMode` dělá:
1. Volá `updateLinearIssue("In Progress", ...)` — přesunout do worker.ts
2. Spustí execution — **zůstane**
3. Spustí validaci — **zůstane**
4. Na úspěch: git add/commit/push, createPullRequest — **zůstane**
5. Volá `updateLinearIssue("In Review", prUrl)` — přesunout do worker.ts
6. Volá `deletePlan(redis, ...)` — přesunout do worker.ts
7. Na selhání: `updateLinearIssue("Todo", errors)` — přesunout do worker.ts

**Nová** funkce:

```typescript
async function handleExecuteOnlyMode(
    task: Task,
    workDir: string,
    homeDir: string,
    git: any,
    trace: any,
    plan: string,
): Promise<AgentResult> {
    const execSpan = trace.span({ name: "Execution-Sonnet-Approved-Plan", metadata: { mode: 'execute-only' } });
    await executePhase(workDir, homeDir, plan);
    execSpan.end();

    const check = await runPolyglotValidation(workDir);

    if (!check.success) {
        const failureSummary = await summarizeFailurePhase(task, homeDir, check.output);
        return { mode: 'execute-only', status: 'validation-failed', validationOutput: check.output, failureSummary };
    }

    await git.add('.');
    const status = await git.status();

    if (status.staged.length === 0) {
        return { mode: 'execute-only', status: 'no-changes' };
    }

    await git.commit("feat: " + task.title);
    const pushArgs = task.isIteration ? [] : ['--force'];
    await git.push('origin', task.branchName, pushArgs);

    let prUrl: string | null = null;
    if (!task.isIteration) {
        const prBody = await generatePRDescription(workDir, git, task.description || '', check);
        prUrl = await createPullRequest(task.repoUrl, task.branchName, "feat: " + task.title, prBody);
    }

    return { mode: 'execute-only', status: 'executed', prUrl, isIteration: task.isIteration ?? false };
}
```

### Krok 1.5 — Refaktorovat `runFullMode`

Stejný princip — 3-iterační smyčka v agent.ts, ale bez Linear volání. Vrátí `AgentResult`.

```typescript
async function runFullMode(
    task: Task,
    workDir: string,
    homeDir: string,
    git: any,
    trace: any,
    availableSkills: string,
    targetClaudeDir: string,
): Promise<AgentResult> {
    let previousErrors = "";
    for (let i = 0; i < 3; i++) {
        const result = await runIteration(i + 1, { trace, workDir, homeDir, task, availableSkills, git }, previousErrors);
        await persistClaudeCache(targetClaudeDir);
        if (result.success) {
            // result.agentResult obsahuje AgentResult z iterace
            return result.agentResult;
        }
        previousErrors = result.output || "Unknown error";
    }
    // Po 3 selháních
    const failureSummary = await summarizeFailurePhase(task, homeDir, previousErrors);
    return { mode: 'full', status: 'validation-failed', validationOutput: previousErrors, failureSummary };
}
```

`runIteration` musí být upraven: pokud validace projde — provede git/commit/push/PR a vrátí `AgentResult`. Nevolá Linear.

### Krok 1.6 — Upravit `runAgent` signaturu a return type

```typescript
export const runAgent = async (task: Task): Promise<AgentResult> => {
    // ... zbytek beze změny, ale bez redis parametru
    // Vrátí výsledek z příslušného modu
};
```

### Krok 1.7 — Aktualizovat `src/worker.ts`

Worker převezme veškerou Linear/Redis orchestraci. Přidat `updateLinearIssue` helper přímo do worker.ts (nebo do nového `src/platform-utils.ts`).

**Nový `jobProcessor`:**

```typescript
import { runAgent, AgentResult, Task, RateLimitError } from './agent';
import { storePlan, deletePlan } from './plan-store';
import { formatPlanForLinear } from './plan-formatter';
import { LinearClient as RalphLinearClient } from './linear-client';

async function updateLinearIssue(issueId: string, statusName: string, comment?: string) {
    if (!process.env.LINEAR_API_KEY) return;
    try {
        const linearClient = new RalphLinearClient();
        await linearClient.updateIssueState(issueId, statusName);
        if (comment) await linearClient.postComment(issueId, comment);
    } catch (e: any) {
        console.error("Linear update failed: " + e.message);
    }
}

export const jobProcessor = async (job: Job) => {
    const taskData: Task = {
        ...job.data,
        jobId: job.id as string,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 1,
        mode: job.data.mode || 'full',
    };

    const linearClient = new RalphLinearClient();
    const { ticketId } = taskData;

    // Informovat Linear o zahájení (PŘED zavoláním agenta)
    if (taskData.mode === 'plan-only') {
        if (taskData.isIteration) {
            await linearClient.updateIssueState(ticketId, "In Progress");
            await linearClient.postComment(ticketId, `🔄 Ralph is creating iteration plan...\n\n📋 **Job ID:** \`${job.id}\``);
        } else {
            await linearClient.updateIssueState(ticketId, "In Progress");
            await linearClient.postComment(ticketId, `🤖 Ralph is generating implementation plan...\n\n📋 **Job ID:** \`${job.id}\``);
        }
    } else if (taskData.mode === 'execute-only') {
        await updateLinearIssue(ticketId, "In Progress", `🤖 Ralph is executing approved plan...\n\n📋 **Job ID:** \`${job.id}\``);
    } else {
        // full mode
        await updateLinearIssue(ticketId, "In Progress", `🤖 Ralph started working\n\n📋 **Job ID:** \`${job.id}\``);
    }

    let result: AgentResult;
    try {
        result = await runAgent(taskData);
    } catch (e: any) {
        if (e.name === 'RateLimitError') {
            await job.moveToDelayed(Date.now() + 60000, job.token);
            return;
        }
        throw e;
    }

    // Zpracovat výsledek (platformová odpovědnost)
    await handleAgentResult(result, taskData, redisConnection, job.id as string);
};

async function handleAgentResult(result: AgentResult, task: Task, redis: IORedis, jobId: string): Promise<void> {
    const linearClient = new RalphLinearClient();
    const { ticketId } = task;

    if (result.status === 'plan-generated') {
        // Uložit plán do Redisu
        await storePlan(redis, ticketId, {
            taskId: ticketId,
            plan: result.plan,
            taskContext: {
                ticketId,
                title: task.title,
                description: task.description,
                repoUrl: task.repoUrl,
                branchName: task.branchName,
                isIteration: task.isIteration,
            },
            feedbackHistory: task.additionalFeedback ? [task.additionalFeedback] : [],
            createdAt: new Date(),
            status: 'pending-review',
        });
        // Zformátovat a poslat plán do Linearu
        const formattedPlan = formatPlanForLinear(result.plan, task.title);
        await linearClient.postComment(ticketId, formattedPlan);
        // Přesunout ticket do "To-do" (čeká na schválení)
        await linearClient.updateIssueState(ticketId, "Todo");
        return;
    }

    if (result.status === 'executed') {
        if (result.isIteration) {
            await updateLinearIssue(ticketId, "In Review", "✅ Iteration complete. Changes pushed to existing PR.");
        } else {
            // Počkat 3s na Linear auto-switch
            await new Promise(r => setTimeout(r, 3000));
            const currentState = await linearClient.getIssueState(ticketId);
            if (currentState?.toLowerCase() === 'in review') {
                await linearClient.postComment(ticketId, "✅ Done. PR: " + result.prUrl);
            } else {
                await updateLinearIssue(ticketId, "In Review", "✅ Done. PR: " + result.prUrl);
            }
            // Smazat plán z Redisu
            await deletePlan(redis, ticketId);
        }
        return;
    }

    if (result.status === 'no-changes') {
        await updateLinearIssue(ticketId, "Todo", "⚠️ No changes necessary.");
        return;
    }

    if (result.status === 'validation-failed') {
        const failComment = `❌ Execution completed but validation failed.\n\n${result.failureSummary}\n\n\`\`\`\n${result.validationOutput.substring(0, 1000)}\n\`\`\``;
        await updateLinearIssue(ticketId, "Todo", failComment);
        return;
    }
}
```

### Krok 1.8 — Tombstone zůstane v worker.ts

`worker.ts` already sets tombstones in `worker.on('completed')`. Tombstone logika se nemění.

### Krok 1.9 — Aktualizovat `tests/agent.test.ts`

Po refaktoru agent.ts **nepotřebuje** mock pro:
- `LinearClient`
- `IORedis`
- `plan-store`
- `plan-formatter`

Tyto mocky odstranit z agent.test.ts. Agent testy ověřují pouze:
- `runAgent()` vrací správný `AgentResult`
- `planPhase()` je zavolána správně
- `executePhase()` je zavolána správně
- Validace je spuštěna

### Krok 1.10 — Aktualizovat `tests/worker.test.ts`

Worker testy musí nově ověřovat Linear a Redis orchestraci:
- Před zavoláním agenta: Linear state update + comment
- Po `plan-generated`: storePlan + postComment + updateState("Todo")
- Po `executed`: deletePlan + postComment s PR URL
- Po `validation-failed`: updateState("Todo") s chybovým komentářem

### Acceptance criteria pro Fázi 1

- [ ] `src/agent.ts` nemá žádný import `IORedis`, `LinearClient`, `storePlan`, `deletePlan`, `formatPlanForLinear`
- [ ] `runAgent()` přijímá `Task` (bez redis) a vrací `Promise<AgentResult>`
- [ ] `src/worker.ts` obsahuje `updateLinearIssue()` helper
- [ ] `src/worker.ts` importuje `storePlan`, `deletePlan`, `formatPlanForLinear`, `LinearClient`
- [ ] `tests/agent.test.ts` neobsahuje mock pro `LinearClient`, `IORedis`, `plan-store`
- [ ] `npm test` projde bez chyb

---

## Fáze 2 — Zod validace Linear webhook payloadů

### Proč

`src/server.ts` obsahuje ~30 výrazů ve stylu `data?.x?.y || 'fallback'`. To je nečitelné, špatně debugovatelné a nezachytí chyby struktury payloadu.

### Krok 2.1 — Nainstalovat Zod

```bash
npm install zod
```

### Krok 2.2 — Vytvořit `src/infra/webhook-schemas.ts`

Zod schémata parsují raw Linear payload a transformují ho na doménové typy z `src/domain/types.ts`. Tato vrstva je tenký most mezi HTTP světem a doménou.

```typescript
import { z } from 'zod';
import type { WebhookIssue, WebhookComment } from '../domain/types';

// Interní Zod schémata (neexportovat — implementační detail)
const LabelSchema = z.object({ name: z.string() });
const StateSchema = z.object({ name: z.string(), label: z.string().optional() });
const TeamSchema = z.object({ key: z.string().optional() });
const UserSchema = z.object({ name: z.string().optional(), displayName: z.string().optional() });

const IssuePayloadSchema = z.object({
    id: z.string(),
    identifier: z.string().default(''),
    title: z.string(),
    description: z.string().optional(),
    labels: z.array(LabelSchema).default([]),
    state: StateSchema.optional(),
    team: TeamSchema.optional(),
});

const CommentPayloadSchema = z.object({
    id: z.string(),
    body: z.string().default(''),
    user: UserSchema.optional(),
    issue: z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        state: StateSchema.optional(),
        team: TeamSchema.optional(),
        identifier: z.string().optional(),
    }).optional(),
});

/** Parsuje raw webhook data na WebhookIssue nebo vrací error */
export function parseIssuePayload(data: unknown): { ok: true; issue: WebhookIssue } | { ok: false; error: string } {
    const result = IssuePayloadSchema.safeParse(data);
    if (!result.success) return { ok: false, error: result.error.message };
    const d = result.data;
    return {
        ok: true,
        issue: {
            id: d.id,
            identifier: d.identifier,
            title: d.title,
            description: d.description,
            labels: d.labels,
            state: d.state,
            team: d.team,
        },
    };
}

/** Parsuje raw webhook data na WebhookComment nebo vrací error */
export function parseCommentPayload(data: unknown): { ok: true; comment: WebhookComment } | { ok: false; error: string } {
    const result = CommentPayloadSchema.safeParse(data);
    if (!result.success) return { ok: false, error: result.error.message };
    const d = result.data;
    return {
        ok: true,
        comment: {
            id: d.id,
            body: d.body,
            author: { name: d.user?.name, displayName: d.user?.displayName },
            issue: d.issue,
        },
    };
}
```

### Krok 2.3 — Použít parsery v `src/server.ts`

V `handleIssueWebhook` a `handleCommentWebhook` nahradit `data: any` za volání parserů. Poté předat doménové typy do domain funkcí:

```typescript
import { parseIssuePayload, parseCommentPayload } from '../infra/webhook-schemas';
import { hasRalphLabel, shouldSkipIssueWebhook, routeComment } from '../domain/webhook-routing';

// handleIssueWebhook
async function handleIssueWebhook(data: unknown, action: string, res: express.Response) {
    const parsed = parseIssuePayload(data);
    if (!parsed.ok) {
        logger.warn({ error: parsed.error }, 'Invalid issue payload');
        return res.status(400).send({ error: 'invalid_payload' });
    }
    const issue = parsed.issue;

    if (!hasRalphLabel(issue)) { ... }
    if (shouldSkipIssueWebhook(action, issue.state?.name ?? '')) { ... }
    // ... zbytek bez data?.x?.y
}

// handleCommentWebhook
async function handleCommentWebhook(data: unknown, res: express.Response) {
    const parsed = parseCommentPayload(data);
    if (!parsed.ok) {
        logger.warn({ error: parsed.error }, 'Invalid comment payload');
        return res.status(400).send({ error: 'invalid_payload' });
    }

    const routing = routeComment(parsed.comment, storedPlan);
    switch (routing.action) {
        case 'ignore':   return res.status(200).send({ status: 'ignored', reason: routing.reason });
        case 'approve':  return handlePlanApproval(issueId, routing.storedPlan, res);
        case 'revise':   return handlePlanRevisionFeedback(issueId, routing.storedPlan, routing.feedback, res);
        case 'iterate':  return handleIterationRequest(routing, res);
    }
}
```

Switch na `routing.action` nahrazuje celou sérii `if/else` podmínek v původním `handleCommentWebhook`.

### Krok 2.4 — Aktualizovat `tests/server.test.ts`

Testy zůstanou funkčně stejné — payloady ve fixtures jsou platné a Zod je propustí. Přidat negativní test case pro neplatný payload.

### Acceptance criteria pro Fázi 2

- [ ] `src/infra/webhook-schemas.ts` existuje a exportuje `parseIssuePayload`, `parseCommentPayload`
- [ ] Parsery vrací doménové typy z `src/domain/types.ts`
- [ ] `src/server.ts` neobsahuje `data: any` — používá parsované doménové typy
- [ ] `src/server.ts` volá `routeComment()` z domain vrstvy místo inline `if/else` podmínek
- [ ] Endpoint vrátí `400` na neplatný payload
- [ ] `npm test` projde

---

## Fáze 3 — Pino strukturované logování

### Proč

V produkci na GKE jdou logy do Stackdriveru. `console.log("✅ text")` je nevyhledávatelný string. Pino produkuje JSON logy s timestamps, level, a strukturovanými poli — standardní pro cloud.

### Krok 3.1 — Nainstalovat Pino

```bash
npm install pino
npm install --save-dev pino-pretty
```

### Krok 3.2 — Vytvořit `src/logger.ts`

```typescript
import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});
```

### Krok 3.3 — Nahradit console.log v celé `src/`

Projít všechny soubory v `src/` a nahradit:

| Původní | Nové |
|---------|------|
| `console.log(...)` | `logger.info(...)` |
| `console.warn(...)` | `logger.warn(...)` |
| `console.error(...)` | `logger.error(...)` |

Pro logy s kontextem preferovat strukturovaná pole:
```typescript
// Místo:
console.log(`📥 [API] Adding ${type} job to queue:`);

// Použít:
logger.info({ jobId, type, repo: jobData.repoUrl }, 'Adding job to queue');
```

**Soubory ke změně:**
- `src/server.ts` — ~20 console volání
- `src/worker.ts` — ~15 console volání
- `src/agent.ts` — ~15 console volání
- `src/workspace.ts` — pokud existují console volání
- `src/linear-client.ts` — pokud existují console volání

### Krok 3.4 — Přidat `LOG_LEVEL` do `.env.example`

```
LOG_LEVEL=info   # debug | info | warn | error
```

### Acceptance criteria pro Fázi 3

- [ ] `src/logger.ts` existuje a exportuje `logger`
- [ ] Žádné `console.log/warn/error` v `src/` (pouze v testech)
- [ ] V development módu je výstup pino-pretty (čitelný)
- [ ] V production módu je výstup JSON
- [ ] `npm test` projde

---

## Fáze 4 — Bun runtime migrace

### Proč

- Odstraní `NODE_OPTIONS=--experimental-vm-modules npx jest` z test příkazu
- Odstraní `ts-jest`, `ts-node` závislosti
- Odstraní `dotenv` závislost (Bun načítá .env nativně)
- Zjednoduší tooling pro nové vývojáře

### Krok 4.1 — Nainstalovat Bun

Vývojáři: `curl -fsSL https://bun.sh/install | bash`

CI/CD: přidat do Dockerfile a pipeline.

### Krok 4.2 — Aktualizovat `package.json`

```json
{
  "scripts": {
    "build": "bun build src/server.ts --outdir dist --target node && bun build src/worker.ts --outdir dist --target node",
    "start:api": "bun run src/server.ts",
    "start:worker": "bun run src/worker.ts",
    "test": "bun test"
  }
}
```

Odstranit ze `dependencies`:
- `dotenv` (Bun načítá .env nativně)

Odstranit z `devDependencies`:
- `ts-jest`
- `@types/jest` (bun:test má vlastní typy)

Ponechat:
- `jest` → nahradit `bun test` (žádný package potřeba)
- `supertest` → **ponechat** (HTTP testování stále funguje s Bunem)

### Krok 4.3 — Vytvořit `bunfig.toml`

```toml
[test]
preload = ["./tests/setup.ts"]
timeout = 30000
```

### Krok 4.4 — Aktualizovat testy pro bun:test

`bun:test` je Jest-kompatibilní API. Změny jsou minimální:

```typescript
// Místo: import { describe, it, expect, jest } from '@jest/globals'
import { describe, it, expect, mock, spyOn } from 'bun:test';

// jest.fn() → mock()
// jest.mock() → mock.module() — viz bun:test docs
```

Upozornění: `jest.mock()` s factory function se přepisuje na `mock.module()`. Pokud je migrace testů příliš komplexní, ponechat Jest a pouze přejít na `bun run` pro server/worker.

### Krok 4.5 — Aktualizovat Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build src/server.ts --outdir dist --target node
RUN bun build src/worker.ts --outdir dist --target node

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules

CMD ["bun", "run", "dist/server.js"]
```

### Acceptance criteria pro Fázi 4

- [ ] `bun test` projde (nebo `npm test` pokud jest zachován)
- [ ] `bun run src/server.ts` nastartuje server
- [ ] Docker build projde s `oven/bun` base image
- [ ] Žádný `dotenv` import v `src/` (Bun načítá .env automaticky — nebo ponechat dotenv pro kompatibilitu s Node fallback)

---

## Pořadí implementace a rozdělení práce

### Krok 1 — Společný základ (jeden vývojář, jeden PR, ~2 hodiny)

```
PR #1: src/domain/types.ts
```

Tento PR musí projít jako první, protože definuje typy, které všechny ostatní větve importují. Je malý a rychle reviewovatelný.

### Krok 2 — Paralelní práce (po merge PR #1)

Čtyři PR mohou vznikat současně na oddělených větvích:

```
PR #2 (Dev A): src/domain/webhook-routing.ts + tests/domain/webhook-routing.test.ts
PR #3 (Dev B): src/domain/agent-outcomes.ts  + tests/domain/agent-outcomes.test.ts
PR #4 (Dev C): src/infra/webhook-schemas.ts  (Zod — Fáze 2)
PR #5 (Dev D): src/infra/logger.ts + nahrazení console.log (Pino — Fáze 3)
```

Tyto PR jsou na sobě nezávislé a nezasahují do stejných souborů.

### Krok 3 — Boundary refactor (po merge PR #2 a PR #3)

```
PR #6: Fáze 1 — agent.ts + worker.ts refactor
```

Tento PR je největší. Závisí na domain typech z PR #2 a #3. Vhodné pro pair programming nebo podrobný review.

### Krok 4 — Integrace Zod do server.ts (po merge PR #4 a PR #6)

```
PR #7: server.ts přepis na Zod typy + domain routing funkce
```

Po tomto PR server.ts volá pouze `routeComment()`, `hasRalphLabel()`, `shouldSkipIssueWebhook()` z domain vrstvy — žádnou přímou byznys logiku.

### Krok 5 — Bun migrace (po merge všeho výše)

```
PR #8: Fáze 4 — package.json, bunfig.toml, Dockerfile, migrace testů
```

Provádí se jako poslední, protože mění tooling pod všemi ostatními soubory.

---

## Jak poznat, že je vrstva správně oddělena

Jednoduchý test pro každou vrstvu:

| Vrstva | Test oddělení |
|--------|---------------|
| `src/domain/` | Importy: pouze `./types` a Node.js built-ins. Žádný `npm install` potřeba. Testy bez mocků. |
| `src/infra/webhook-schemas.ts` | Importuje `zod` a `../domain/types`. Nic jiného. |
| `src/infra/logger.ts` | Importuje `pino`. Nic jiného. |
| `src/agent/agent.ts` | Importuje `./workspace`, `./tools`, `langfuse`, `@octokit/rest`, `node:*`. Žádný `LinearClient`, žádný `IORedis`. |
| `src/platform/worker.ts` | Smí importovat vše — je to orchestrační vrstva. |
| `src/platform/server.ts` | Byznys logika pouze přes domain funkce. Žádné inline `if (body.includes('lgtm'))`. |

---

## Co NEMĚNIT

- `src/tools.ts` — polyglot validace, logika je správná
- `src/workspace.ts` — git workspace management, funguje
- `src/plan-store.ts` — Redis plán persistence, čistá utilita
- `src/plan-formatter.ts` — formátování plánu pro Linear
- `src/linear-client.ts` — Linear SDK wrapper
- `src/linear-utils.ts` — synonym mapping pro stavy
- `src/mcp-toonify.ts` — MCP token optimalizace

Tyto soubory jsou stabilní. Refactor se týká pouze orchestrační a doménové vrstvy.

---

## Poznámky pro implementující agent

- Zachovat `SECURITY_GUARDRAILS` v `src/agent.ts` — nesmí se přesunout ani změnit
- `createPullRequest()` zůstane v `src/agent.ts` — potřebuje workspace context (git diff)
- `generatePRDescription()` zůstane v `src/agent.ts` — taktéž workspace context
- `summarizeFailurePhase()` zůstane v `src/agent.ts` — LLM volání (Haiku)
- `RateLimitError` zůstane exportovaný z `src/agent.ts` — worker.ts ho chytá
- Tombstone logika v `worker.ts` se nemění (jen `execute-only` a `full` mode jobs)
- `PLAN_REVIEW_ENABLED` env var — logika zůstane v `runAgent()`, přepíná `full → plan-only`
- `AgentResult` typ definovat v `src/domain/types.ts` a importovat do `src/agent.ts` — ne naopak
