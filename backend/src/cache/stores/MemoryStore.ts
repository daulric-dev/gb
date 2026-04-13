import { CacheInterface } from "./cache.interface";

type Entry = {
    value: any;
    expires: number;
}

export class MemoryStore implements CacheInterface {
    private store: Map<string, Entry> = new Map();

    async get(key: string): Promise<any> {
        return this.store.get(key);
    }

    async set(key: string, value: any, ttl: number): Promise<void> {
        this.store.set(
            key, 
            { value, expires: Date.now() + ttl }
        );
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    async clear(): Promise<void> {
        this.store.clear();
    }

}