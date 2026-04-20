import { RedisStore, MemoryStore, CacheStore } from './stores';
import { Redis } from 'ioredis';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CacheService implements CacheStore {
  private readonly store: CacheStore;
  private readonly logger = new Logger(CacheService.name);

  constructor() {
    if (process.env.USE_REDIS === 'true') {
      const redis = new Redis(process.env.REDIS_URL!);
      this.store = new RedisStore(redis);
      this.logger.log('Using Redis Store');
    } else {
      this.store = new MemoryStore();
      this.logger.log('Using Memory Store');
    }
  }

  async get(key: string): Promise<any> {
    this.logger.log(`Getting cache key: ${key}`);
    return this.store.get(key);
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    this.logger.log(`Setting cache key: ${key}`);
    return this.store.set(key, value, ttl);
  }

  async update<T>(key: string, func: (value: T) => T | Promise<T>, ttl: number): Promise<boolean> {
    this.logger.log(`Updating cache key: ${key}`);
    const value = await this.store.get(key) as T | null;
    if (value === null) return false;
    await this.store.set(key, await func(value), ttl);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.logger.log(`Deleting cache key: ${key}`);
    return this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    this.logger.log(`Deleting cache by prefix: ${prefix}`);
    return this.store.deleteByPrefix(prefix);
  }

  async clear(): Promise<void> {
    this.logger.log(`Clearing cache`);
    return this.store.clear();
  }
}
