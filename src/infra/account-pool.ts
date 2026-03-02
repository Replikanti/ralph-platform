/**
 * Account Pool — manages a pool of Claude Max flat-rate accounts.
 *
 * Each account is a subdirectory under CLAUDE_ACCOUNTS_DIR containing
 * `.credentials.json` (and optionally `settings.json`). The pool tracks
 * rate-limited accounts in Redis and rotates to the next available account
 * when a rate limit is hit.
 *
 * Directory structure:
 *   /claude-accounts/
 *     account-0/
 *       .credentials.json
 *       settings.json  (optional)
 *     account-1/
 *       .credentials.json
 */

import fs from 'node:fs';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import type IORedis from 'ioredis';
import { logger } from './logger';

interface ClaudeAccount {
    id: string;
    path: string;
}

const REDIS_KEY_PREFIX = 'ralph:account:ratelimited:';

export class AccountPool {
    private readonly accounts: ClaudeAccount[];
    private readonly redis: IORedis;
    private readonly rateLimitTtlMs: number;

    constructor(accountsDir: string, redis: IORedis) {
        this.redis = redis;
        const ttlMinutes = Number.parseInt(process.env.CLAUDE_RATE_LIMIT_TTL_MINUTES ?? '60', 10);
        this.rateLimitTtlMs = ttlMinutes * 60 * 1000;

        this.accounts = this.scanAccounts(accountsDir);

        if (this.accounts.length === 0) {
            logger.warn(`⚠️ AccountPool: no accounts found in ${accountsDir}. Claude CLI calls will use system HOME credentials.`);
        } else {
            logger.info(`🔑 AccountPool: loaded ${this.accounts.length} account(s) from ${accountsDir}`);
        }
    }

    private scanAccounts(accountsDir: string): ClaudeAccount[] {
        if (!fs.existsSync(accountsDir)) {
            logger.warn(`⚠️ AccountPool: directory ${accountsDir} does not exist`);
            return [];
        }

        const accounts: ClaudeAccount[] = [];
        try {
            const entries = fs.readdirSync(accountsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const accountPath = path.join(accountsDir, entry.name);
                const credsFile = path.join(accountPath, '.credentials.json');
                if (fs.existsSync(credsFile)) {
                    accounts.push({ id: entry.name, path: accountPath });
                    logger.debug(`AccountPool: registered account ${entry.name}`);
                } else {
                    logger.warn(`⚠️ AccountPool: skipping ${entry.name} — no .credentials.json found`);
                }
            }
        } catch (e: any) {
            logger.error(`❌ AccountPool: failed to scan ${accountsDir}: ${e.message}`);
        }

        return accounts.sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * Returns the path of the first non-rate-limited account.
     * Falls back to the first account (with a warning) if all are rate-limited.
     */
    async getCredentialsDir(): Promise<string> {
        for (const account of this.accounts) {
            const key = REDIS_KEY_PREFIX + account.id;
            const blocked = await this.redis.get(key);
            if (!blocked) {
                return account.path;
            }
        }

        // All rate-limited — fall back to first with warning
        if (this.accounts.length > 0) {
            logger.warn(`⚠️ AccountPool: all accounts rate-limited, falling back to ${this.accounts[0].id}`);
            return this.accounts[0].path;
        }

        // No accounts configured — caller must handle using system HOME
        throw new Error('AccountPool: no accounts configured');
    }

    /**
     * Marks an account as rate-limited in Redis.
     * ttl = retryAfterMs if provided, otherwise rateLimitTtlMs from env.
     */
    async markRateLimited(accountPath: string, retryAfterMs?: number): Promise<void> {
        const account = this.accounts.find(a => a.path === accountPath);
        if (!account) {
            logger.warn(`⚠️ AccountPool: markRateLimited called with unknown path: ${accountPath}`);
            return;
        }

        const ttlMs = retryAfterMs ?? this.rateLimitTtlMs;
        const ttlSeconds = Math.ceil(ttlMs / 1000);
        const key = REDIS_KEY_PREFIX + account.id;
        await this.redis.set(key, '1', 'EX', ttlSeconds);
        logger.info(`🔒 AccountPool: marked ${account.id} as rate-limited for ${ttlSeconds}s`);
    }

    /**
     * Returns true if at least one account is not rate-limited.
     */
    async hasAvailableAccount(): Promise<boolean> {
        for (const account of this.accounts) {
            const key = REDIS_KEY_PREFIX + account.id;
            const blocked = await this.redis.get(key);
            if (!blocked) return true;
        }
        return false;
    }

    /**
     * Returns the shortest wait time in milliseconds until an account becomes available.
     * If an account is already available, returns 0.
     * If no accounts are configured, returns undefined.
     */
    async getShortestWaitTimeMs(): Promise<number | undefined> {
        if (this.accounts.length === 0) return undefined;

        let shortestWait: number | undefined;

        for (const account of this.accounts) {
            const key = REDIS_KEY_PREFIX + account.id;
            const pttl = await this.redis.pttl(key);
            
            if (pttl === -2) {
                // -2 means key does not exist (account is available)
                return 0;
            }

            if (pttl > 0) {
                if (shortestWait === undefined || pttl < shortestWait) {
                    shortestWait = pttl;
                }
            }
        }

        return shortestWait;
    }

    /**
     * Seeds Claude credentials from the active account into destDir/.claude/.
     * Copies .credentials.json and settings.json if present.
     */
    async seedCredentials(destDir: string): Promise<void> {
        let accountPath: string;
        try {
            accountPath = await this.getCredentialsDir();
        } catch {
            logger.warn('⚠️ AccountPool: no accounts to seed from — skipping credential seeding');
            return;
        }

        const targetClaudeDir = path.join(destDir, '.claude');
        await fsPromises.mkdir(targetClaudeDir, { recursive: true });

        for (const f of ['.credentials.json', 'settings.json']) {
            const src = path.join(accountPath, f);
            if (fs.existsSync(src)) {
                try {
                    await fsPromises.copyFile(src, path.join(targetClaudeDir, f));
                } catch (e: any) {
                    logger.warn(`⚠️ AccountPool: failed to copy ${f}: ${e.message}`);
                }
            }
        }
    }
}

const _state: { pool: AccountPool | undefined } = { pool: undefined };

export const accountPool: Pick<AccountPool, 'getCredentialsDir' | 'markRateLimited' | 'hasAvailableAccount' | 'seedCredentials' | 'getShortestWaitTimeMs'> = {
    getCredentialsDir: (...args) => _state.pool!.getCredentialsDir(...args),
    markRateLimited: (...args) => _state.pool!.markRateLimited(...args),
    hasAvailableAccount: (...args) => _state.pool!.hasAvailableAccount(...args),
    seedCredentials: (...args) => _state.pool!.seedCredentials(...args),
    getShortestWaitTimeMs: (...args) => _state.pool!.getShortestWaitTimeMs(...args),
};

export function initAccountPool(accountsDir: string, redis: IORedis): void {
    _state.pool = new AccountPool(accountsDir, redis);
}
