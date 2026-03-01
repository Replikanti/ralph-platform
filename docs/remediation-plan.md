# Remediation Plan — Ralph Platform Audit

Tento dokument popisuje všechny nalezené problémy a konkrétní kroky k jejich nápravě.
Každý fix je atomický a lze ho implementovat nezávisle.

Implementuj vždy v nové větvi pojmenované podle fixu (např. `fix/timing-attack-signature`),
otevři PR proti `main`, počkej na CI.

---

## FIX 1 — Security: Timing attack na HMAC signature check

**Soubor:** `src/platform/server.ts`
**Řádky:** 150–157
**Závažnost:** MEDIUM

### Problém

Před `timingSafeEqual()` je early-return na délku bufferů:

```typescript
if (signatureBuffer.length !== digestBuffer.length) {
    return false;
}
return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
```

Útočník může měřit dobu odezvy a zjistit, zda jeho podpis má správnou délku —
tím pádem ví, že pracuje s SHA-256 a může optimalizovat útok.

### Oprava

Odstraniž early-return na délku. Místo toho vždy porovnávej dva SHA-256 hashe
(oba jsou fixní délky = 64 hex znaků). Nejistá délka vstupního `signature` headeru
se odstraní hashováním přes HMAC — porovnáváš `digest(secret, body)` vs `digest(secret, signature)`,
ne `signature` přímo.

```typescript
function verifyLinearSignature(req: any): boolean {
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    if (!secret) {
        logger.error("❌ LINEAR_WEBHOOK_SECRET is not set!");
        return false;
    }

    const signature = req.headers['linear-signature'];
    if (!signature || typeof signature !== 'string') return false;

    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(req.rawBody || '').digest('hex');

    // Oba buffery jsou vždy 64-byte (SHA-256 hex) — žádný timing leak přes délku.
    // Nevracíme false před timingSafeEqual, i když by délka nesouhlasila.
    try {
        return crypto.timingSafeEqual(
            Buffer.from(digest, 'hex'),
            Buffer.from(signature.padEnd(digest.length, '\0').substring(0, digest.length), 'hex')
        );
    } catch {
        return false;
    }
}
```

**Poznámka:** Čistší je porovnávat hex stringy přes `timingSafeEqual(Buffer.from(digest), Buffer.from(digest_of_signature))`.
Implementuj tak, aby oba buffery byly stejné délky bez podmínek.

---

## FIX 2 — Security: Unredacted error messages v logu a Linear komentáři

**Soubory:** `src/platform/worker.ts`
**Řádky:** 29, 51, 182, 190
**Závažnost:** MEDIUM

### Problém

Chybové zprávy z agenta, z Linear API a z BullMQ se logují a posílají jako komentář
do Linear bez redakce. Pokud by error obsahoval API klíč nebo PII (např. z git remote URL
s tokenem), byl by viditelný v logu a v Linear ticketu.

```typescript
// řádek 29
logger.error("Linear update failed: " + e.message);

// řádek 51
logger.error("Failed to notify Linear of job start: " + e.message);

// řádek 182
logger.error(`❌ [Worker] Job ${job.id} failed ... ${err.message}`);

// řádek 190 — odesílá se do Linear jako komentář!
`❌ Critical System Failure\n\nError: ${err.message}`
```

### Oprava

Před každým logováním `err.message` a před sestavením Linear komentáře zavolej `redactText()`.
Importuj `redactText` z `'../security/redactor'`.

```typescript
import { redactText } from '../security/redactor';

// Všude kde je err.message / e.message v logu nebo Linear komentáři:
const safeMsg = await redactText(err.message ?? '');
logger.error(`❌ [Worker] Job ${job.id} failed: ${safeMsg}`);

// Pro Linear komentář (řádek ~190):
const safeMsg = await redactText(err.message ?? '');
const failComment = `❌ Critical System Failure\n\nError: ${safeMsg}`;
```

Upravit je potřeba tato místa v worker.ts (vyhledej všechny výskyty `e.message` a `err.message`):
- catch blok u Linear state update (řádek ~29)
- catch blok u `notifyLinearJobStart` (řádek ~51)
- BullMQ `failed` event handler (řádky ~182, 190)

---

## FIX 3 — Security: Claude stdout/stderr streaming bez redakce

**Soubor:** `src/infra/claude-runner.ts`
**Řádky:** 44, 52
**Závažnost:** MEDIUM

### Problém

Claude CLI output se streamuje přímo na `process.stdout`/`process.stderr`:

```typescript
child.stdout.on('data', (data: Buffer) => {
    const str = data.toString();
    stdout += str;
    process.stdout.write(str);  // ← žádná redakce
});
child.stderr.on('data', (data: Buffer) => {
    const str = data.toString();
    stderr += str;
    process.stderr.write(str);  // ← žádná redakce
});
```

Pokud agent přečte soubor s tajemstvím a vytiskne ho (např. při debugování),
tajemství se dostane do systémového logu.

### Oprava

Jednoduše **odstraň** `process.stdout.write` a `process.stderr.write` — oba řádky.
Finální `stdout` a `stderr` strings jsou stejně vráceny volajícímu, který je loguje
přes Pino (kde již je možné zapnout redakci).
Přímý streaming na process.stdout je zbytečný (jde o workerový process bez terminálového výstupu).

```typescript
// SMAZAT tyto dva řádky:
process.stdout.write(str);
process.stderr.write(str);
```

Pokud je real-time výpis žádoucí pro lokální development, obal to do podmínky:
```typescript
if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(str);
}
```

---

## FIX 4 — Security: Command injection v cp příkazech

**Soubor:** `src/agent/agent.ts`
**Řádek:** ~213
**Závažnost:** HIGH (mitigováno tím, že cesty pochází z naší konfigurace, ale špatný vzor)

### Problém

```typescript
execSync("cp -r " + sourceDir + "/* " + targetDir + "/");
```

String concatenation bez escapování. Cesty z `/tmp/ralph-workspaces/` jsou z naší
konfigurace (ne od uživatele), ale vzor je nebezpečný — stačí jeden bug výše v callsite.

### Oprava

Nahraď shellový příkaz Node.js `fs` operacemi nebo použij `spawn` s polem argumentů
(které nespouští shell):

```typescript
import { cpSync } from 'node:fs';

// Místo: execSync("cp -r " + sourceDir + "/* " + targetDir + "/");
cpSync(sourceDir, targetDir, { recursive: true });
```

Alternativně, pokud `cpSync` nestačí (globbing `/*`), použij:
```typescript
import { spawnSync } from 'node:child_process';

spawnSync('cp', ['-r', sourceDir + '/.', targetDir + '/'], { stdio: 'inherit' });
// spawnSync neprojde shellem — neinterpretuje metacharacters
```

Vyhledej v `agent.ts` VŠECHNA místa kde `execSync` nebo `exec` přijímá string
se string-concatenated cestami a nahraď je výše popsaným vzorem.

---

## FIX 5 — Code Quality: Duplikovaná sanitize() logika

**Soubor:** `src/agent/tools.ts`
**Řádky:** 119–123 a 131–136
**Závažnost:** LOW

### Problém

Funkce `sanitize()` je definována dvakrát uvnitř `runCommand()` — jednou v `try` bloku
(max 5000 znaků) a jednou v `catch` bloku (max 2000 znaků) — s různými limity.

### Oprava

Vyextrahuj na jednu privátní funkci mimo `runCommand()` s konfigurovatelným limitem:

```typescript
async function sanitizeOutput(str: string, maxLen = 5000): Promise<string> {
    if (!str) return '';
    const truncated = str.length > maxLen
        ? str.substring(0, maxLen) + '\n... (truncated)'
        : str;
    return redactText(truncated);
}
```

V `runCommand()`:
- `try` blok: `const safeStdout = await sanitizeOutput(result.stdout, 5000);`
- `catch` blok: `const safeStdout = await sanitizeOutput(stdout, 2000);`

---

## FIX 6 — Code Quality: Nepoužívaný `agentTools` export

**Soubor:** `src/agent/tools.ts`
**Řádky:** 147–192
**Závažnost:** LOW

### Problém

```typescript
export const agentTools = [ ... ]; // JSON schema pro Anthropic tools
```

Tento export není nikde importován ani použit. Agent volá Claude CLI přímo,
ne přes Anthropic SDK s tool definitions.

### Oprava

Smaž celý blok `export const agentTools = [...]` (řádky 147–192).
Před smazáním ověř pomocí full-text search (`grep -r "agentTools" src/ tests/`),
že skutečně není použit.

---

## FIX 7 — Architecture: Přímá závislost worker → agent implementace

**Soubor:** `src/platform/worker.ts`
**Řádek:** 5
**Závažnost:** HIGH (architektonická čistota)

### Problém

```typescript
import { runAgent, Task } from '../agent/agent';
```

`platform/worker.ts` závisí přímo na konkrétní implementaci agenta. Správná vrstvová
architektura vyžaduje, aby `platform/` závisel pouze na abstrakci (interface), ne na implementaci.

### Oprava

**Krok 1:** Přesuň `Task` a `AgentResult` typy (pokud ještě nejsou) do `src/domain/types.ts`.
Tyto typy už tam pravděpodobně jsou — ověř.

**Krok 2:** Vytvoř `src/domain/agent-contract.ts`:

```typescript
import type { Task, AgentResult } from './types';

/**
 * Contract, který musí splňovat každá implementace agenta.
 * Platform layer závisí pouze na tomto interface.
 */
export interface IAgent {
    run(task: Task): Promise<AgentResult>;
}
```

**Krok 3:** Uprav `src/agent/agent.ts` — exportuj funkci `runAgent` která splňuje kontrakt
(pravděpodobně již splňuje signaturu, jen přidej typovou anotaci):

```typescript
import type { IAgent } from '../domain/agent-contract';

// Ověř, že runAgent má správnou signaturu:
export const runAgent: IAgent['run'] = async (task: Task): Promise<AgentResult> => {
    // ... stávající implementace
};
```

**Krok 4:** Uprav `src/platform/worker.ts`:

```typescript
// Místo:
import { runAgent, Task } from '../agent/agent';

// Takto:
import type { IAgent } from '../domain/agent-contract';
import type { Task } from '../domain/types';
import { runAgent } from '../agent/agent';
```

Tím `worker.ts` závisí na `domain/agent-contract` (abstrakce) a konkrétní `runAgent`
je jen dosazením za tento interface. V budoucnu lze vyměnit agenta bez změny workeru.

---

## FIX 8 — Architecture: Langfuse v agent vrstvě (platform concern)

**Soubor:** `src/agent/agent.ts`
**Řádky:** 2, 12, 163–171 a všude kde je `trace.span()`
**Závažnost:** MEDIUM (architektonická čistota)

### Problém

```typescript
import { Langfuse } from "langfuse";           // řádek 2
const langfuse = new Langfuse();                // řádek 12

async function withTrace<T>(name, metadata, fn) {
    const trace = langfuse.trace({ ... });     // Langfuse přímo v agent.ts
    ...
}
```

Agent (business logika) by neměl vědět, jak se monitoruje. Tracing je platform concern.

### Oprava

**Krok 1:** Vytvoř `src/domain/tracer-contract.ts`:

```typescript
/**
 * Minimální tracer interface — agent ví jen o tomto, ne o Langfuse.
 */
export interface ITracer {
    /** Obalí async funkci do trace spanu. */
    span<T>(name: string, metadata: Record<string, unknown>, fn: () => Promise<T>): Promise<T>;
}

/** No-op implementace pro testy a lokální spuštění bez Langfuse. */
export const noopTracer: ITracer = {
    span: (_name, _meta, fn) => fn(),
};
```

**Krok 2:** Uprav `src/agent/agent.ts`:

```typescript
// SMAZAT:
import { Langfuse } from "langfuse";
const langfuse = new Langfuse();
async function withTrace<T>(...) { ... }

// PŘIDAT do signatury runAgent:
import type { ITracer } from '../domain/tracer-contract';
import { noopTracer } from '../domain/tracer-contract';

export async function runAgent(task: Task, tracer: ITracer = noopTracer): Promise<AgentResult> {
    // Místo withTrace()/trace.span() volej tracer.span():
    return tracer.span('Ralph-Task', { ticketId: task.ticketId }, async () => {
        // ... stávající logika
    });
}
```

**Krok 3:** Uprav `src/platform/worker.ts` — vytvoř Langfuse tracer a předej agentovi:

```typescript
import { Langfuse } from 'langfuse';
import type { ITracer } from '../domain/tracer-contract';

function createLangfuseTracer(): ITracer {
    const langfuse = new Langfuse();
    return {
        span: async (name, metadata, fn) => {
            const trace = langfuse.trace({ name, metadata });
            try {
                return await fn();
            } catch (e: any) {
                trace.update({ metadata: { error: e.message } });
                throw e;
            } finally {
                await langfuse.flushAsync();
            }
        }
    };
}

// Při volání agenta:
const tracer = createLangfuseTracer();
const result = await runAgent(task, tracer);
```

**Krok 4:** Uprav testy v `tests/agent.test.ts` — předávej `noopTracer`:
```typescript
import { noopTracer } from '../src/domain/tracer-contract';
const result = await runAgent(task, noopTracer);
```

---

## FIX 9 — Architecture: CLI-specifické argumenty v executePhase()

**Soubor:** `src/agent/agent.ts`
**Řádky:** 186–198
**Závažnost:** MEDIUM (architektonická čistota)

### Problém

```typescript
async function executePhase(workDir: string, homeDir: string, plan: string) {
    return await runClaude([
        '--dangerously-skip-permissions',
        '--permission-mode', 'bypassPermissions',
        '--max-budget-usd', '2.00',
        ...
    ], workDir, homeDir, 900000);
}
```

Hardcoded CLI argumenty (`--dangerously-skip-permissions`, budget, timeout) jsou
implementation detail patřící do `infra/claude-runner.ts`, ne do business logiky agenta.

### Oprava

**Krok 1:** Vytvoř typovanou konfiguraci v `src/infra/claude-runner.ts`:

```typescript
export interface ClaudeRunConfig {
    prompt: string;
    model?: string;
    tools?: string;
    maxBudgetUsd?: number;
    timeoutMs?: number;
    allowPermissionBypass?: boolean;
}

export async function runClaudeExecution(config: ClaudeRunConfig, workDir: string, homeDir: string) {
    const args = ['-p', config.prompt];
    if (config.model)   args.push('--model', config.model);
    if (config.tools)   args.push('--tools', config.tools);
    if (config.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(config.maxBudgetUsd));
    if (config.allowPermissionBypass) {
        args.push('--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions');
    }
    args.push('--no-session-persistence');
    return runClaude(args, workDir, homeDir, config.timeoutMs ?? 300000);
}
```

**Krok 2:** Uprav `executePhase()` v `agent.ts`:

```typescript
import { runClaudeExecution } from '../infra/claude-runner';

async function executePhase(workDir: string, homeDir: string, plan: string) {
    const prompt = "You are the Executor. Implement this plan: " + plan;
    return runClaudeExecution({
        prompt,
        model: 'sonnet',
        tools: 'Bash,Read,Edit,FileSearch,Glob',
        maxBudgetUsd: 2.00,
        timeoutMs: 900_000,
        allowPermissionBypass: true,
    }, workDir, homeDir);
}
```

---

## Pořadí implementace

Doporučené pořadí (od nejkritičtějšího k nejméně):

| Pořadí | Fix | Větev | Typ |
|--------|-----|-------|-----|
| 1 | FIX 2 — Unredacted errors v logu/Linear | `fix/redact-error-messages` | Security |
| 2 | FIX 3 — Smazat stdout/stderr streaming | `fix/remove-claude-stdout-streaming` | Security |
| 3 | FIX 4 — Command injection v cp příkazech | `fix/cp-command-injection` | Security |
| 4 | FIX 1 — Timing attack na signature | `fix/timing-safe-signature` | Security |
| 5 | FIX 6 — Smazat agentTools export | `fix/remove-unused-agenttools` | Cleanup |
| 6 | FIX 5 — Deduplikovat sanitize() | `fix/deduplicate-sanitize` | Cleanup |
| 7 | FIX 9 — CLI args do claude-runner | `refactor/cli-args-to-runner` | Architecture |
| 8 | FIX 7 — IAgent interface | `refactor/iagent-interface` | Architecture |
| 9 | FIX 8 — ITracer interface (Langfuse DI) | `refactor/itracer-dependency-injection` | Architecture |

---

## Verifikace po každém fixu

Po každém PR spusť:
```bash
npm test
```

Všech 129 testů musí projít. Pokud nějaký selže, fix je neúplný.

Po architektonických fixech (FIX 7, 8, 9) navíc ověř:
```bash
bun test tests/security-architecture.test.ts
bun test tests/agent.test.ts
bun test tests/worker.test.ts
```
