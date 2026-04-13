import { CacheInterface } from "./cache.interface";

type Entry = {
    value: any;
    expires: number;
}

export class MemoryStore implements CacheInterface {
    private store: Map<string, Entry> = new Map();

    async get(key: string): Promise<any> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    async set(key: string, value: any, ttl: number): Promise<void> {
        this.store.set(
            key, 
            { value, expires: Date.now() + ttl * 1000 }
        );
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    async deleteByPrefix(prefix: string): Promise<void> {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) this.store.delete(key);
        }
    }

    async clear(): Promise<void> {
        this.store.clear();
    }

}