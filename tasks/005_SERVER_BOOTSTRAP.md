# Task 005: Create Ts.ED Server Bootstrap

## Objective
Create the main Ts.ED Server class (`Server.ts`) and entry point (`index.ts`) that bootstraps the platform with all global middleware configurations.

## Prerequisites
- 004 (RedisProvider exists)

## Reference Files
- `src/server.ts` lines 17-23 (Express app + helmet + morgan)
- `src/server.ts` lines 128-133 (raw body capture middleware)
- `src/server.ts` lines 448-478 (graceful shutdown)

## Deliverables
- `src/Server.ts`
- `src/index.ts`

## Instructions

### 1. Create `src/Server.ts`

```typescript
import { Configuration, Inject, PlatformApplication } from "@tsed/common";
import { PlatformExpress } from "@tsed/platform-express";
import "@tsed/swagger";
import helmet from "helmet";
import morgan from "morgan";
import express from "express";
import { RedisProvider } from "./services/RedisProvider";

@Configuration({
    port: 3000,
    acceptMimes: ["application/json"],
    swagger: [
        {
            path: "/api-docs",
            specVersion: "3.0.1",
        },
    ],
    imports: [
        RedisProvider,
    ],
})
export class Server {
    @Inject()
    private app!: PlatformApplication;

    /**
     * Called before routes are loaded.
     * Configure global Express middleware here.
     */
    $beforeRoutesInit(): void {
        // Security headers
        this.app.use(helmet());

        // HTTP request logging
        this.app.use(morgan("combined"));

        // JSON body parser with raw body capture for HMAC signature verification.
        // CRITICAL: The raw body buffer must be captured BEFORE any JSON parsing.
        // This is the same pattern as the current server.ts lines 128-133.
        this.app.use(
            express.json({
                limit: "10mb",
                verify: (req: any, _res: express.Response, buf: Buffer) => {
                    req.rawBody = buf;
                },
            })
        );
    }
}
```

### 2. Create `src/index.ts`

```typescript
import "reflect-metadata";
import { PlatformExpress } from "@tsed/platform-express";
import { Server } from "./Server";

async function bootstrap() {
    const platform = await PlatformExpress.bootstrap(Server);
    await platform.listen();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`${signal} received. Shutting down...`);
        await platform.stop();
        process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
```

### Critical Details

1. **`reflect-metadata` must be imported FIRST** in `index.ts` before any other imports. This is required for TypeScript decorators to work at runtime.
2. **Raw body capture:** The `verify` callback in `express.json()` captures the raw Buffer into `req.rawBody`. This is essential for HMAC signature verification in the webhook middleware (Task 009). This must be configured in `$beforeRoutesInit()` to run before Ts.ED's own body parser.
3. **Swagger:** Configured at `/api-docs` for API documentation. This is a bonus of the Ts.ED migration.
4. **Graceful shutdown:** Ts.ED's `platform.stop()` automatically calls `$onDestroy()` on all services (including RedisProvider), handling cleanup.

### Important Notes

- The old `src/server.ts` continues to work alongside. Do NOT modify it yet.
- Do NOT add controller imports to the `@Configuration` yet - they'll be added in Tasks 015-016.
- The old entry point (`if (require.main === module)` in server.ts) still works for the old code.
- Update `package.json` scripts later (Task 023) to point to the new entry point.

## Acceptance Criteria
- [ ] `src/Server.ts` exists with `@Configuration` decorator
- [ ] `src/index.ts` exists with `reflect-metadata` import as first line
- [ ] Raw body capture middleware is configured in `$beforeRoutesInit()`
- [ ] Helmet and Morgan middleware are configured
- [ ] Swagger is configured at `/api-docs`
- [ ] `npm run build` compiles without errors
- [ ] Existing tests still pass (old code untouched)
