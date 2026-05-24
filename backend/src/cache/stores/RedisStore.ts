import { RedisClient } from 'bun';
import { Logger } from '@nestjs/common';
import { CacheInterface } from './cache.interface';

const KEEPALIVE_INTERVAL_MS = 60_000;

export class RedisStore implements CacheInterface {
  private readonly logger = new Logger(RedisStore.name);
  private readonly keepalive: ReturnType<typeof setInterval>;

  constructor(private readonly redis: RedisClient) {
    this.keepalive = setInterval(() => {
      this.redis.send('PING', []).catch((err) => {
        this.logger.warn(`Redis keepalive ping failed: ${String(err)}`);
      });
    }, KEEPALIVE_INTERVAL_MS);
    this.keepalive.unref?.();
  }

  dispose(): void {
    clearInterval(this.keepalive);
    this.redis.close?.();
  }

  async get(key: string): Promise<any> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  async clear(): Promise<void> {
    await this.redis.send("FLUSHALL", ["ASYNC"]);
  }
}
