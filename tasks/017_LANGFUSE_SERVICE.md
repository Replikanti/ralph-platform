# Task 017: Create LangfuseService

## Objective
Wrap Langfuse tracing in an injectable Ts.ED service, replacing the global `const langfuse = new Langfuse()` in agent.ts.

## Prerequisites
- 003 (env config with Langfuse vars)

## Reference Files
- `src/agent.ts` line 14 (`const langfuse = new Langfuse()`)
- `src/agent.ts` lines 286-294 (`withTrace` helper)
- `src/agent.ts` lines 422-448 (span creation: Planning, Execution, Validation)
- `src/agent.ts` lines 600-606 (trace creation with metadata)

## Deliverables
- `src/services/LangfuseService.ts`

## Instructions

```typescript
import { Service, OnDestroy } from "@tsed/common";
import { Logger } from "@tsed/logger";
import { Langfuse } from "langfuse";

@Service()
export class LangfuseService implements OnDestroy {
    private langfuse: Langfuse;
    private logger = new Logger("LangfuseService");

    constructor() {
        // Langfuse reads LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_HOST
        // from environment automatically
        this.langfuse = new Langfuse();
    }

    async $onDestroy(): Promise<void> {
        await this.langfuse.flushAsync();
        this.logger.info("Langfuse flushed on shutdown");
    }

    /**
     * Execute a function within a Langfuse trace.
     * Automatically captures errors and flushes on completion.
     *
     * Replaces the `withTrace` helper from agent.ts.
     */
    async withTrace<T>(
        name: string,
        metadata: Record<string, any>,
        fn: (trace: any) => Promise<T>
    ): Promise<T> {
        const trace = this.langfuse.trace({ name, metadata });
        try {
            return await fn(trace);
        } catch (e: any) {
            trace.update({ metadata: { error: e.message } });
            throw e;
        } finally {
            await this.langfuse.flushAsync();
        }
    }
}
```

### Key Design Decisions

1. **Constructor initialization**: Langfuse client created in constructor (it reads env vars automatically). No async init needed.
2. **`$onDestroy()`**: Flushes any pending traces before shutdown.
3. **`withTrace()`**: Exact same pattern as agent.ts - creates trace, calls function, captures errors, flushes.
4. **Trace object passed to callback**: The `fn` receives the raw Langfuse trace object so callers can create spans directly (matching current agent.ts pattern).

### Important Notes

- Langfuse SDK automatically reads `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_HOST` from environment. No need to pass them explicitly.
- If Langfuse env vars are not set, the SDK silently no-ops. This is the desired behavior for local development.

## Acceptance Criteria
- [ ] `src/services/LangfuseService.ts` exists with `@Service()` decorator
- [ ] Implements `$onDestroy()` to flush pending traces
- [ ] `withTrace()` method with same signature as agent.ts helper
- [ ] Error metadata captured on trace when `fn` throws
- [ ] `npm run build` compiles without errors
