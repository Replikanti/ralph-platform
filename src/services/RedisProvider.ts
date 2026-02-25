import { Service, OnInit, OnDestroy } from "@tsed/common";
import { Logger } from "@tsed/logger";
import IORedis from "ioredis";
import { REDIS_URL } from "../config/env";

@Service()
export class RedisProvider implements OnInit, OnDestroy {
    private _connection: IORedis | null = null;
    private readonly logger = new Logger("RedisProvider");

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
