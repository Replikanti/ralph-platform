# Remediation Plan 2 — Ralph Platform Audit (2026-02-28)

Tento dokument navazuje na `remediation-plan.md`. Popisuje nálezy
z druhého auditu a konkrétní kroky k jejich nápravě.
Každý fix je atomický. Implementuj vždy v nové větvi, otevři PR proti `main`.

---

## FIX 1 — Dead code: Nepoužívané funkce `updatePlanStatus` a `appendFeedback`

**Soubor:** `src/infra/plan-store.ts`
**Řádky:** 35–58
**Závažnost:** HIGH
**Kategorie:** dead-code

### Problém

```typescript
export async function updatePlanStatus(redis, taskId, status): Promise<void> { ... }
export async function appendFeedback(redis, taskId, feedback): Promise<void> { ... }
```

Obě funkce jsou exportované, testované v `tests/plan-store.test.ts` a mockované
v `tests/server.test.ts` a `tests/worker.test.ts`, ale v produkčním kódu nikde
nevolané. Stav plánu se aktualizuje přímým `storePlan()` (v `worker.ts`),
nikoli přes tyto helpery. Zbytečný povrch API — každá veřejná funkce je implicitní
kontrakt, který je třeba udržovat.

### Oprava

**Krok 1:** Smazat z `src/infra/plan-store.ts` funkce `updatePlanStatus` a `appendFeedback`
(řádky 35–58). Zůstanou jen `storePlan`, `getPlan`, `deletePlan`.

**Krok 2:** Smazat z `tests/plan-store.test.ts` testy těchto dvou funkcí.

**Krok 3:** Odstranit ze všech mock.module() volání v testech:
- `tests/server.test.ts`: `mockUpdatePlanStatus`, `mockAppendFeedback`
- `tests/worker.test.ts`: `updatePlanStatus`, `appendFeedback` z mocku

---

## FIX 2 — Security: Tichá chyba při kopírování credentials v BAML proxy

**Soubor:** `src/infra/baml-proxy.ts`
**Řádek:** 67
**Závažnost:** MEDIUM
**Kategorie:** security / dead-code

### Problém

```typescript
try { await fsPromises.copyFile(src, path.join(claudeDir, f)); } catch { /* ignore */ }
```

Pokud se nepodaří zkopírovat `.credentials.json` nebo `settings.json`, Claude CLI
spuštěné z BAML proxy nemá přihlašovací údaje a selže. Tato chyba je tiše spolknuta
— operátor neví, proč BAML volání selhávají.

### Oprava

```typescript
// Místo:
try { await fsPromises.copyFile(src, path.join(claudeDir, f)); } catch { /* ignore */ }

// Takto:
try {
    await fsPromises.copyFile(src, path.join(claudeDir, f));
} catch (e) {
    logger.warn({ err: e }, `⚠️ BAML proxy: failed to copy ${f} — Claude CLI may lack credentials`);
}
```

---

## FIX 3 — Security: `storedPlan: any` na API hranici v server.ts

**Soubor:** `src/platform/server.ts`
**Řádky:** 185, 211, 236 (signatury funkcí)
**Závažnost:** MEDIUM
**Kategorie:** security / architecture

### Problém

```typescript
async function handlePlanApproval(issueId: string, storedPlan: any, res): Promise<...>
async function handlePlanRevisionFeedback(issueId: string, storedPlan: any, ...): Promise<...>
```

`any` na vstupu webhook handleru obchází typovou kontrolu. Pokud se struktura plánu
v Redisu změní (migrace formátu), chyba se neodhalí při kompilaci, ale až za běhu —
potenciálně s data leakem nebo neočekávaným chováním.

### Oprava

**Krok 1:** Přidat import do `server.ts`:

```typescript
import type { StoredPlanContext } from '../domain/types';
```

**Krok 2:** Nahradit `any` v signaturách:

```typescript
// handlePlanApproval — řádek 185
async function handlePlanApproval(
    issueId: string,
    storedPlan: StoredPlanContext,
    res: express.Response
): Promise<express.Response>

// handlePlanRevisionFeedback — řádek 211
async function handlePlanRevisionFeedback(
    issueId: string,
    storedPlan: StoredPlanContext,
    commentBody: string,
    res: express.Response
): Promise<express.Response>
```

`handleIterationRequest` nepřijímá `storedPlan`, takže není potřeba měnit.

---

## FIX 4 — Architecture: `git: any` → `SimpleGit` v agent.ts

**Soubor:** `src/agent/agent.ts`
**Řádky:** 22 (`IterationContext`), 65 (`generatePRDescription`), 450, 465
**Závažnost:** MEDIUM
**Kategorie:** architecture

### Problém

```typescript
interface IterationContext {
    ...
    git: any;   // ← žádná typová kontrola
}

async function generatePRDescription(
    workDir: string,
    git: any,   // ← diffSummary(), push() — vše neznámé
    ...
```

Bez typování je nemožné zjistit při kompilaci, jaké metody jsou dostupné.
Při refaktoringu gitových operací se chyby odhalí až za běhu.

### Oprava

**Krok 1:** Přidat import do `agent.ts`:

```typescript
import type { SimpleGit } from 'simple-git';
```

**Krok 2:** Nahradit `git: any` na všech místech:

```typescript
interface IterationContext {
    ...
    git: SimpleGit;
}

async function generatePRDescription(
    workDir: string,
    git: SimpleGit,
    ...
```

Funkce `runFullMode`, `handleExecuteOnlyMode` a `runAgent` — totéž.
TypeScript pak automaticky odvodí správný typ pro `diffStats` z `git.diffSummary()`,
čímž se opraví i vedlejší `any` v `diffStats.files?.filter((f: any) => ...)`.

---

## FIX 5 — Architecture: `task: any` → `Task` v `planPhase()`

**Soubor:** `src/agent/agent.ts`
**Řádek:** 148
**Závažnost:** MEDIUM
**Kategorie:** architecture

### Problém

```typescript
async function planPhase(_workDir: string, _homeDir: string, task: any, ...
```

`task` je volán jako `b.PlanTask({ title: task.title, description: task.description ?? '' })`.
Pokud by se `Task` interface v domain/types změnil a `title` byl přejmenován,
kompilátor to neodhalí — `any` smaže chybové hlášky.

### Oprava

```typescript
// Místo:
async function planPhase(_workDir: string, _homeDir: string, task: any, ...)

// Takto:
async function planPhase(_workDir: string, _homeDir: string, task: Task, ...)
```

`Task` je již importován na řádku 9 — žádný nový import není potřeba.

---

## FIX 6 — Architecture: `team: any` → minimální interface v `findTargetState()`

**Soubor:** `src/infra/linear-utils.ts`
**Řádek:** 11
**Závažnost:** MEDIUM
**Kategorie:** architecture

### Problém

```typescript
export async function findTargetState(team: any, statusName: string) {
    const states = await team.states();
```

Funkce volá `team.states()` a přistupuje na `states.nodes[].name/id`, ale žádná
z těchto vlastností není typovaná. Změna v Linear SDK se neodhalí při kompilaci.

### Oprava

Definovat minimální strukturální interface (bez importu celého Linear SDK):

```typescript
interface TeamWithStates {
    states(): Promise<{ nodes: Array<{ name: string; id: string }> }>;
}

export async function findTargetState(team: TeamWithStates, statusName: string) {
```

Structural typing zajistí kompatibilitu s Linear SDK's `Team` objektem
bez nutnosti přidávat závislost na SDK typy v `infra/linear-utils.ts`.

---

## FIX 7 — Architecture: Redundantní `fs.mkdirSync` na úrovni modulu v agent.ts

**Soubor:** `src/agent/agent.ts`
**Řádky:** 174–177
**Závažnost:** LOW
**Kategorie:** architecture / dead-code

### Problém

```typescript
const CLAUDE_CACHE_ROOT = process.env.CLAUDE_CACHE_PATH || '/app/claude-cache';
if (!fs.existsSync(CLAUDE_CACHE_ROOT)) {
    try { fs.mkdirSync(CLAUDE_CACHE_ROOT, { recursive: true }); } catch (e: any) {
        logger.warn("Could not create cache root: " + e.message);
    }
}
```

Blokující synchronní I/O při importu modulu. Navíc je redundantní:
`syncDirectoryContents()` volá `await fsPromises.mkdir(targetDir, { recursive: true })`
s `targetDir = path.join(CLAUDE_CACHE_ROOT, 'projects')` — `recursive: true`
vytvoří i nadřazený adresář `CLAUDE_CACHE_ROOT` automaticky.

### Oprava

Smazat celý blok (řádky 174–178):

```typescript
// SMAZAT:
const CLAUDE_CACHE_ROOT = process.env.CLAUDE_CACHE_PATH || '/app/claude-cache';
if (!fs.existsSync(CLAUDE_CACHE_ROOT)) {
    try { fs.mkdirSync(CLAUDE_CACHE_ROOT, { recursive: true }); } catch (e: any) {
        logger.warn("Could not create cache root: " + e.message);
    }
}

// Zachovat pouze konstantu (přesunout za blok):
const CLAUDE_CACHE_ROOT = process.env.CLAUDE_CACHE_PATH || '/app/claude-cache';
```

---

## FIX 8 — Security: JSON body limit 10 MB v server.ts

**Soubor:** `src/platform/server.ts`
**Řádek:** 130
**Závažnost:** LOW
**Kategorie:** security

### Problém

```typescript
app.use(express.json({ limit: '10mb', ... }));
```

Linear webhooky jsou typicky <10 KB. Limit 10 MB umožňuje útočníkovi
poslat megabajtové payloady a tím vyčerpat paměť serveru (low-cost DoS).
Podpis je ověřován až POTÉ, co Express payload naparsuje do paměti.

### Oprava

```typescript
app.use(express.json({ limit: '1mb', ... }));
```

1 MB je dostatečný pro libovolný reálný Linear webhook
a eliminuje triviální paměťový DoS vektor.

---

## FIX 9 — Architecture: Validace `PLAN_TTL_DAYS` v plan-store.ts

**Soubor:** `src/infra/plan-store.ts`
**Řádek:** 11
**Závažnost:** LOW
**Kategorie:** architecture

### Problém

```typescript
const PLAN_TTL_DAYS = Number.parseInt(process.env.PLAN_TTL_DAYS || '7', 10);
```

Pokud by operátor nastavil `PLAN_TTL_DAYS=0` nebo `PLAN_TTL_DAYS=abc`
(výsledek `NaN`), TTL by bylo 0 nebo `NaN * seconds = NaN`,
Redis by plány ukládal s neplatným TTL (nebo je vůbec neexiroval).

### Oprava

```typescript
const _ttlDays = Number.parseInt(process.env.PLAN_TTL_DAYS || '7', 10);
const PLAN_TTL_DAYS = Number.isFinite(_ttlDays) && _ttlDays > 0 ? _ttlDays : 7;
```

---

## Pořadí implementace

| Pořadí | Fix | Větev | Závažnost | Typ |
|--------|-----|-------|-----------|-----|
| 1 | FIX 1 — Smazat `updatePlanStatus` + `appendFeedback` | `fix/remove-unused-plan-store-fns` | HIGH | Dead code |
| 2 | FIX 2 — Log místo tichého catch v baml-proxy | `fix/baml-proxy-credential-warning` | MEDIUM | Security |
| 3 | FIX 3 — `storedPlan: any` → `StoredPlanContext` | `fix/type-stored-plan-server` | MEDIUM | Security |
| 4 | FIX 4 — `git: any` → `SimpleGit` | `refactor/type-git-simplegit` | MEDIUM | Architecture |
| 5 | FIX 5 — `task: any` → `Task` v planPhase | `refactor/type-plan-phase-task` | MEDIUM | Architecture |
| 6 | FIX 6 — `team: any` → `TeamWithStates` interface | `refactor/type-linear-team` | MEDIUM | Architecture |
| 7 | FIX 7 — Smazat redundantní mkdirSync | `fix/remove-redundant-mkdirsync` | LOW | Architecture |
| 8 | FIX 8 — JSON limit 10mb → 1mb | `fix/reduce-json-body-limit` | LOW | Security |
| 9 | FIX 9 — Validace PLAN_TTL_DAYS | `fix/validate-plan-ttl-days` | LOW | Architecture |

---

## Verifikace po každém fixu

```bash
bun test
```

Všech 129 testů musí projít. Pokud selžou — fix je neúplný.

Po FIX 1 navíc ověř:
```bash
bun test tests/plan-store.test.ts
bun test tests/server.test.ts
bun test tests/worker.test.ts
```

Po FIX 4 (SimpleGit typing) ověř že TypeScript kompiluje bez chyb:
```bash
bun run build
```
