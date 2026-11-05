import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { redisConnectionOptions, redisEnabled } from '@/realtime/redis.util';

/** Shape of `ThrottlerStorage.increment`'s result in @nestjs/throttler 6.x. */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

export const THROTTLE_KEY_PREFIX = 'throttle:';

/** How often (at most) a Redis failure is logged while falling back. */
const FALLBACK_WARN_INTERVAL_MS = 60_000;

/**
 * The atomic counter script, kept in `throttle.lua` beside this file (see it
 * for KEYS/ARGV and the reply). nest-cli.json copies it into dist.
 */
export const THROTTLE_LUA = readFileSync(
  join(__dirname, 'throttle.lua'),
  'utf8',
);

export const THROTTLE_LUA_SHA = createHash('sha1')
  .update(THROTTLE_LUA)
  .digest('hex');

/** The slice of the ioredis client this storage uses (mockable in tests). */
export type ThrottleRedisClient = Pick<Redis, 'evalsha' | 'eval' | 'quit'>;

/**
 * `ThrottlerStorage` backed by Redis so every API replica shares one counter
 * per key. A Redis failure never fails the request: that call is counted in a
 * per-process in-memory storage instead (limits stay enforced, per replica)
 * and a warning is logged at most once a minute.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private suppressedWarnings = 0;
  private destroyed = false;

  constructor(
    private readonly client: ThrottleRedisClient,
    private readonly now: () => number = Date.now,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.incrementInRedis(key, ttl, limit, blockDuration);
    } catch (err) {
      this.warnFallback(err);
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fallback.onApplicationShutdown();
    await Promise.allSettled([this.client.quit()]);
  }

  private async incrementInRedis(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    // One hash tag so both keys land in the same slot under Redis Cluster.
    const base = `${THROTTLE_KEY_PREFIX}{${key}}`;
    const args = [
      2,
      `${base}:hits`,
      `${base}:block`,
      Math.max(1, Math.ceil(ttl)),
      limit,
      Math.max(1, Math.ceil(blockDuration)),
    ] as const;

    let raw: unknown;
    try {
      raw = await this.client.evalsha(THROTTLE_LUA_SHA, ...args);
    } catch (err) {
      if (!String((err as Error)?.message ?? err).includes('NOSCRIPT')) {
        throw err;
      }
      // First call on this Redis (or after SCRIPT FLUSH): EVAL loads it.
      raw = await this.client.eval(THROTTLE_LUA, ...args);
    }

    if (!Array.isArray(raw) || raw.length < 4) {
      throw new Error('unexpected throttle script reply');
    }
    const [hits, expireMs, blocked, blockMs] = raw.map(Number);
    // Same units as the library's in-memory storage: whole seconds, rounded up.
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(expireMs / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }

  private warnFallback(err: unknown): void {
    const now = this.now();
    if (now - this.lastWarnAt < FALLBACK_WARN_INTERVAL_MS) {
      this.suppressedWarnings++;
      return;
    }
    const suppressed = this.suppressedWarnings
      ? ` (${this.suppressedWarnings} more since last warning)`
      : '';
    this.lastWarnAt = now;
    this.suppressedWarnings = 0;
    this.logger.warn(
      `Redis rate-limit storage failed, counting in memory for this replica: ${
        (err as Error)?.message ?? String(err)
      }${suppressed}`,
    );
  }
}

/**
 * The shared storage when `USE_REDIS=true` (and `REDIS_URL` is set), else
 * `undefined` so `@nestjs/throttler` uses its default in-memory storage.
 *
 * The client fails fast instead of queueing while Redis is unreachable
 * (the shared realtime options queue forever), so a Redis outage costs a
 * request at most `commandTimeout` before falling back.
 */
export function createThrottlerStorage(): RedisThrottlerStorage | undefined {
  if (!redisEnabled()) return undefined;
  const client = new Redis({
    ...redisConnectionOptions(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 500,
  });
  const logger = new Logger(RedisThrottlerStorage.name);
  client.on('error', (err: Error) =>
    logger.debug(`throttle Redis client error: ${err.message}`),
  );
  logger.log('Rate limiter using Redis storage');
  return new RedisThrottlerStorage(client);
}
