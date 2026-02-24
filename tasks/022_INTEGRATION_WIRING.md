# Task 022: Integration Wiring and Verification

## Objective
Wire all components together in Server.ts, verify the complete build, and run the full test suite.

## Prerequisites
- ALL previous tasks (001-021)

## Reference Files
- `src/Server.ts` (created in Task 005)
- All services, controllers, and domain files

## Deliverables
- Updated `src/Server.ts` with all imports and mounts
- Verified clean build
- All tests passing

## Instructions

### 1. Update Server.ts with Complete Configuration

```typescript
import { Configuration, Inject, PlatformApplication } from "@tsed/common";
import "@tsed/swagger";
import helmet from "helmet";
import morgan from "morgan";
import express from "express";

// Controllers
import { WebhookController } from "./controllers/WebhookController";
import { SystemController } from "./controllers/SystemController";

// Services (imported so Ts.ED registers them in DI container)
import { RedisProvider } from "./services/RedisProvider";
import { QueueService } from "./services/QueueService";
import { WorkerService } from "./services/WorkerService";
import { ConfigService } from "./services/ConfigService";
import { PlanStoreService } from "./services/PlanStoreService";
import { LinearClientService } from "./services/LinearClientService";
import { GitHubService } from "./services/GitHubService";
import { LangfuseService } from "./services/LangfuseService";
import { AgentOrchestratorService } from "./services/AgentOrchestratorService";

@Configuration({
    port: 3000,
    acceptMimes: ["application/json"],
    swagger: [
        {
            path: "/api-docs",
            specVersion: "3.0.1",
        },
    ],
    mount: {
        "/": [WebhookController, SystemController],
    },
    imports: [
        RedisProvider,
        QueueService,
        WorkerService,
        ConfigService,
        PlanStoreService,
        LinearClientService,
        GitHubService,
        LangfuseService,
        AgentOrchestratorService,
    ],
})
export class Server {
    @Inject()
    private app!: PlatformApplication;

    $beforeRoutesInit(): void {
        this.app.use(helmet());
        this.app.use(morgan("combined"));
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

### 2. Verify Build

```bash
npm run build
```

Fix any compilation errors. Common issues:
- Missing imports
- Type mismatches between services
- Circular dependency warnings (resolve by moving shared types to a separate file)

### 3. Verify Tests

```bash
npm test
```

Both old and new tests should pass during the transition period.

### 4. Check Initialization Order

Ts.ED initializes services in dependency order. Verify:
1. `RedisProvider.$onInit()` runs first (no dependencies)
2. `QueueService.$onInit()` runs after Redis (depends on RedisProvider)
3. `WorkerService.$onInit()` runs after Queue and Orchestrator (depends on both)
4. `SystemController.$onInit()` runs after Queue (for BullBoard)

If there are initialization order issues, use `@Inject()` with explicit provider ordering or move initialization to `$afterRoutesInit()`.

### 5. Manual Smoke Test (Optional)

```bash
# Start Redis
docker-compose up redis -d

# Start the new server
node dist/index.js

# Test health endpoint
curl http://localhost:3000/health

# Test Swagger docs
curl http://localhost:3000/api-docs
```

### Common Issues and Fixes

1. **"Cannot read properties of undefined"** on injected services: Check that the service is listed in `imports` array of `@Configuration`.
2. **"Redis not initialized"**: RedisProvider's `$onInit()` hasn't run yet when another service tries to use it. Ensure proper dependency chain.
3. **Circular imports**: If Service A imports from Service B and vice versa, extract shared types to a separate file (e.g., `src/models/types.ts`).
4. **BullMQ connection error**: Ensure `maxRetriesPerRequest: null` is set in RedisProvider.

## Acceptance Criteria
- [ ] `Server.ts` imports and registers all controllers and services
- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes (both old and new tests)
- [ ] `/health` endpoint returns `{ status: "ok" }`
- [ ] No circular dependency warnings
- [ ] Service initialization order is correct
