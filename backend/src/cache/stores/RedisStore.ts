import { Redis } from "ioredis";
import { CacheInterface } from "./cache.interface";

export class RedisStore implements CacheInterface {
    constructor(private readonly redis: Redis) {}

    async get(key: string): Promise<any> {
        return this.redis.get(key);
    }

    async set(key: string, value: any, ttl: number): Promise<void> {
        await this.redis.set(key, value, 'EX', ttl);
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(key);
    }

    async clear(): Promise<void> {
        await this.redis.flushdb();
    }
}