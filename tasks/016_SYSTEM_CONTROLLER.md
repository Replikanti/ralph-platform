# Task 016: Create SystemController

## Objective
Create the health check endpoint and BullBoard admin dashboard as a Ts.ED controller.

## Prerequisites
- 014 (QueueService with `getQueue()` method)
- 005 (Server.ts exists)

## Reference Files
- `src/server.ts` lines 39-59 (BullBoard setup with basic auth)
- `src/server.ts` lines 444-446 (`/health` endpoint)

## Deliverables
- `src/controllers/SystemController.ts`

## Instructions

```typescript
import { Controller, Get, Res, Inject, PlatformApplication } from "@tsed/common";
import { OnInit } from "@tsed/common";
import { Logger } from "@tsed/logger";
import express from "express";
import basicAuth from "express-basic-auth";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { QueueService } from "../services/QueueService";
import { ADMIN_USER, ADMIN_PASS } from "../config/env";

@Controller("/")
export class SystemController implements OnInit {
    private logger = new Logger("SystemController");

    @Inject() private queue!: QueueService;
    @Inject() private app!: PlatformApplication;

    $onInit(): void {
        this.setupBullBoard();
    }

    @Get("/health")
    healthCheck(@Res() res: express.Response) {
        return res.status(200).send({ status: "ok" });
    }

    private setupBullBoard(): void {
        if (!ADMIN_USER || !ADMIN_PASS) {
            this.logger.warn("ADMIN_USER or ADMIN_PASS not set. Dashboard is disabled.");
            return;
        }

        const serverAdapter = new ExpressAdapter();
        serverAdapter.setBasePath("/admin/queues");

        createBullBoard({
            queues: [new BullMQAdapter(this.queue.getQueue())],
            serverAdapter,
        });

        this.app.use(
            "/admin/queues",
            basicAuth({
                users: { [ADMIN_USER]: ADMIN_PASS },
                challenge: true,
            }),
            serverAdapter.getRouter()
        );

        this.logger.info("Admin dashboard enabled at /admin/queues");
    }
}
```

### Key Design Decisions

1. **BullBoard setup in `$onInit()`**: The dashboard needs the QueueService to be initialized first (for the Queue instance). `$onInit()` runs after all injections are resolved.
2. **Basic auth protection**: Same pattern as current server.ts - only enabled when ADMIN_USER and ADMIN_PASS are both set.
3. **Health endpoint**: Simple `/health` returning `{ status: "ok" }`. Used by Kubernetes liveness probes.
4. **PlatformApplication injection**: Needed to mount the BullBoard Express adapter as raw Express middleware.

### Important Notes

- BullBoard uses its own Express router, which is mounted as raw middleware via `PlatformApplication`. This is a Ts.ED-approved pattern for integrating third-party Express middleware.
- The `/admin/queues` path is NOT managed by Ts.ED routing - it's a raw Express mount. This means Swagger won't document it (which is correct - it's an admin UI, not an API).

## Acceptance Criteria
- [ ] `src/controllers/SystemController.ts` exists with `@Controller("/")` decorator
- [ ] `GET /health` returns `{ status: "ok" }` with 200
- [ ] BullBoard mounted at `/admin/queues` with basic auth (when ADMIN_USER/ADMIN_PASS set)
- [ ] Dashboard disabled gracefully when credentials not configured
- [ ] Injects QueueService and PlatformApplication
- [ ] `npm run build` compiles without errors
