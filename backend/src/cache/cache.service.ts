import { RedisStore, MemoryStore, CacheStore } from './stores';
import { RedisClient } from 'bun';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class CacheService implements CacheStore, OnModuleDestroy {
  private readonly store: CacheStore;
  private readonly logger = new Logger(CacheService.name);

  constructor() {
    if (process.env.USE_REDIS === 'true') {
      const redis = new RedisClient(process.env.REDIS_URL!, {
        autoReconnect: true,
        maxRetries: 20,
        idleTimeout: 0,
      });
      this.store = new RedisStore(redis);
      this.logger.log('Using Redis Store');
    } else {
      this.store = new MemoryStore();
      this.logger.log('Using Memory Store');
    }
  }

  onModuleDestroy(): void {
    (this.store as { dispose?: () => void }).dispose?.();
  }

  async get(key: string): Promise<any> {
    this.logger.log(`Getting cache key: ${key}`);
    try {
      return await this.store.get(key);
    } catch (err) {
      this.logger.error(`Cache get failed for ${key}: ${String(err)}`);
      return null;
    }
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    this.logger.log(`Setting cache key: ${key}`);
    try {
      await this.store.set(key, value, ttl);
    } catch (err) {
      this.logger.error(`Cache set failed for ${key}: ${String(err)}`);
    }
  }

  async update<T>(
    key: string,
    func: (value: T) => T | Promise<T>,
    ttl: number,
  ): Promise<boolean> {
    this.logger.log(`Updating cache key: ${key}`);
    try {
      const value = (await this.store.get(key)) as T | null;
      if (value === null) return false;
      await this.store.set(key, await func(value), ttl);
      return true;
    } catch (err) {
      this.logger.error(`Cache update failed for ${key}: ${String(err)}`);
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    this.logger.log(`Deleting cache key: ${key}`);
    try {
      await this.store.delete(key);
    } catch (err) {
      this.logger.error(`Cache delete failed for ${key}: ${String(err)}`);
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    this.logger.log(`Deleting cache by prefix: ${prefix}`);
    try {
      await this.store.deleteByPrefix(prefix);
    } catch (err) {
      this.logger.error(
        `Cache deleteByPrefix failed for ${prefix}: ${String(err)}`,
      );
    }
  }

  async clear(): Promise<void> {
    this.logger.log(`Clearing cache`);
    try {
      await this.store.clear();
    } catch (err) {
      this.logger.error(`Cache clear failed: ${String(err)}`);
    }
  }
}
