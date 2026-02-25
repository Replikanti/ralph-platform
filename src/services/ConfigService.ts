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
