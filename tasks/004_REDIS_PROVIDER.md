# Task 004: Create RedisProvider Service

## Objective
Create an injectable Ts.ED service that manages shared IORedis connections, replacing the global `const connection = new IORedis(...)` pattern found in `server.ts` and `worker.ts`.

## Prerequisites
- 003 (env config exists)

## Reference Files
- `src/server.ts` lines 30-36 (Redis connection with retry strategy)
- `src/worker.ts` lines 9-15, 44-50 (duplicate Redis connections)
- Current IORedis usage pattern throughout

## Deliverables
- `src/services/RedisProvider.ts`

## Instructions

Create `src/services/RedisProvider.ts`:

```typescript
import { Service, OnInit, OnDestroy } from "@tsed/common";
import { Logger } from "@tsed/logger";
import IORedis from "ioredis";
import { REDIS_URL } from "../config/env";

@Service()
export class RedisProvider implements OnInit, OnDestroy {
    private _connection: IORedis | null = null;
    private logger = new Logger("RedisProvider");

    get connection(): IORedis {
        if (!this._connection) {
            throw new Error("Redis not initialized. Ensure RedisProvider.$onInit() has completed.");
        }
        return this._connection;
    }

    $onInit(): void {
        this._connection = new IORedis(REDIS_URL, {
            maxRetriesPerRequest: null,
            retryStrategy(times: number) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        this._connection.on("connect", () => {
            this.logger.info("Connected to Redis");
        });

        this._connection.on("error", (err) => {
            this.logger.error("Redis connection error:", err.message);
        });
    }

    async $onDestroy(): Promise<void> {
        if (this._connection) {
            this.logger.info("Closing Redis connection...");
            await this._connection.quit();
            this._connection = null;
            this.logger.info("Redis connection closed.");
        }
    }
}
```

### Key Design Decisions

1. **Single connection:** Unlike the current code which creates 2-3 separate IORedis instances (one in server.ts, one or two in worker.ts), this provider manages ONE shared connection.
2. **Retry strategy:** Preserves the exact retry logic from the current code: `Math.min(times * 50, 2000)`.
3. **`maxRetriesPerRequest: null`:** Required by BullMQ - without this, BullMQ will fail after default Redis retry limit.
4. **Lifecycle hooks:** `$onInit()` creates the connection at server startup. `$onDestroy()` gracefully closes it during shutdown.
5. **Getter with guard:** The `connection` getter throws if accessed before initialization, catching DI ordering bugs early.

### Important Notes

- BullMQ requires `maxRetriesPerRequest: null` on the IORedis connection. This is critical.
- This service is a singleton (default in Ts.ED) - all injectors get the same instance.
- Do NOT create separate connections for BullMQ Queue and Worker - BullMQ internally clones connections as needed.

## Acceptance Criteria
- [ ] `src/services/RedisProvider.ts` exists with `@Service()` decorator
- [ ] Implements `$onInit()` and `$onDestroy()` lifecycle hooks
- [ ] Uses `REDIS_URL` from `config/env.ts`
- [ ] Connection retry strategy matches current code: `Math.min(times * 50, 2000)`
- [ ] `maxRetriesPerRequest: null` is set (BullMQ requirement)
- [ ] `npm run build` compiles without errors
