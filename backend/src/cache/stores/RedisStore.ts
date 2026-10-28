import { RedisClient } from 'bun';
import { Logger } from '@nestjs/common';
import { CacheInterface } from './cache.interface';

const KEEPALIVE_INTERVAL_MS = 60_000;

// INCR and the first EXPIRE in one script, so a crash between them cannot
// leave a counter that never expires.
const INCR_WITH_TTL = `local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

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
    try {
      this.redis.close?.();
    } catch {
      // Best effort: the process is already tearing down and the socket should
      // not keep the worker alive.
    }
  }

  async get(key: string): Promise<any> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
  }

  async setIfAbsent(key: string, value: any, ttl: number): Promise<boolean> {
    const res = await this.redis.send('SET', [
      key,
      JSON.stringify(value),
      'NX',
      'EX',
      String(Math.max(1, Math.ceil(ttl))),
    ]);
    return res === 'OK';
  }

  async incr(key: string, ttl: number): Promise<number> {
    const res = await this.redis.send('EVAL', [
      INCR_WITH_TTL,
      '1',
      key,
      String(Math.max(1, Math.ceil(ttl))),
    ]);
    return Number(res);
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
    await this.redis.send('FLUSHALL', ['ASYNC']);
  }
}
