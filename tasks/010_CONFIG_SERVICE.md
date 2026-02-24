# Task 010: Create ConfigService

## Objective
Migrate the team-to-repository mapping logic from `server.ts` into an injectable Ts.ED service with Redis caching and file-based configuration.

## Prerequisites
- 004 (RedisProvider exists)
- 003 (env config with `REPO_CONFIG_PATH`, `DEFAULT_REPO_URL`, `LINEAR_TEAM_REPOS_JSON`)

## Reference Files
- `src/server.ts` lines 25-27 (constants)
- `src/server.ts` lines 62-125 (`getRepoForTeam` function)

## Deliverables
- `src/services/ConfigService.ts`

## Instructions

```typescript
import { Service, Inject } from "@tsed/common";
import { Logger } from "@tsed/logger";
import fs from "node:fs/promises";
import { RedisProvider } from "./RedisProvider";
import { REPO_CONFIG_PATH, DEFAULT_REPO_URL, LINEAR_TEAM_REPOS_JSON } from "../config/env";

const REDIS_CONFIG_KEY = "ralph:config:repos";
const REDIS_VERSION_KEY = "ralph:config:version";

@Service()
export class ConfigService {
    private logger = new Logger("ConfigService");

    @Inject()
    private redis!: RedisProvider;

    /**
     * Resolves the GitHub repository URL for a given Linear team key.
     * Resolution order:
     * 1. ConfigMap file (with Redis cache and mtime-based invalidation)
     * 2. LINEAR_TEAM_REPOS environment variable (JSON, legacy fallback)
     * 3. DEFAULT_REPO_URL environment variable (final fallback)
     */
    async getRepoForTeam(teamKey: string | undefined): Promise<string | null> {
        const conn = this.redis.connection;

        try {
            // 1. Check Redis cache
            const [redisMap, redisVersion] = await Promise.all([
                conn.get(REDIS_CONFIG_KEY),
                conn.get(REDIS_VERSION_KEY),
            ]);

            let config: Record<string, string> = {};
            let currentVersion = "";

            // Check file version (mtime as simple version)
            try {
                const stats = await fs.stat(REPO_CONFIG_PATH);
                currentVersion = stats.mtimeMs.toString();
            } catch {
                // File might not exist in local dev, ignore
            }

            // If Redis is stale or empty, refresh from file
            if (!redisMap || redisVersion !== currentVersion) {
                try {
                    const fileContent = await fs.readFile(REPO_CONFIG_PATH, "utf-8");
                    config = JSON.parse(fileContent);

                    // Update Redis cache
                    await Promise.all([
                        conn.set(REDIS_CONFIG_KEY, JSON.stringify(config)),
                        conn.set(REDIS_VERSION_KEY, currentVersion),
                    ]);
                    this.logger.info("Configuration refreshed from ConfigMap");
                } catch (e: any) {
                    this.logger.warn("Failed to refresh config from file, using Redis fallback:", e.message);
                    if (redisMap) config = JSON.parse(redisMap);
                }
            } else {
                config = JSON.parse(redisMap);
            }

            // 2. Look up in config
            if (teamKey && config[teamKey]) {
                return config[teamKey];
            }
        } catch (e: any) {
            this.logger.warn("Error resolving repo config:", e.message);
        }

        // 3. Fallback to env var (legacy)
        try {
            const envMap = JSON.parse(LINEAR_TEAM_REPOS_JSON);
            if (teamKey && envMap[teamKey]) {
                return envMap[teamKey];
            }
        } catch (e: any) {
            this.logger.error("Invalid LINEAR_TEAM_REPOS JSON:", e.message);
        }

        // 4. Final fallback
        if (DEFAULT_REPO_URL) {
            return DEFAULT_REPO_URL;
        }

        return null;
    }
}
```

### Key Design Decisions

1. **Exact same logic** as `getRepoForTeam()` in server.ts. No behavioral changes.
2. **Inject RedisProvider** instead of using a global connection.
3. **Logger** replaces `console.log`/`console.warn`/`console.error`.
4. **Env vars** from centralized `config/env.ts`.

## Acceptance Criteria
- [ ] `src/services/ConfigService.ts` exists with `@Service()` decorator
- [ ] Injects `RedisProvider` via `@Inject()`
- [ ] `getRepoForTeam()` method with exact same resolution logic as server.ts
- [ ] Uses `@tsed/logger` instead of `console.*`
- [ ] Uses env vars from `config/env.ts`
- [ ] `npm run build` compiles without errors
