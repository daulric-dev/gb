import { RedisStore, MemoryStore, CacheStore } from "./stores"
import { Redis } from "ioredis";
import { Injectable } from "@nestjs/common";

@Injectable()
export class CacheService implements CacheStore {
    private readonly store: CacheStore;

    constructor() {
        if (process.env.USE_REDIS === 'true') {
            const redis = new Redis(process.env.REDIS_URL!);
            this.store = new RedisStore(redis);
        } else {
            this.store = new MemoryStore();
        }
    }

    async get(key: string): Promise<any> {
        return this.store.get(key);
    }

    async set(key: string, value: any, ttl: number): Promise<void> {
        return this.store.set(key, value, ttl);
    }
    
    async delete(key: string): Promise<void> {
        return this.store.delete(key);
    }

    async clear(): Promise<void> {
        return this.store.clear();
    }

}