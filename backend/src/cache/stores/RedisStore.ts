import { Redis } from 'ioredis';
import { CacheInterface } from './cache.interface';

export class RedisStore implements CacheInterface {
  constructor(private readonly redis: Redis) {}

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
    await this.redis.flushdb();
  }
}
