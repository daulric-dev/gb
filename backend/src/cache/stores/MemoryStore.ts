import { CacheInterface } from './cache.interface';

type Entry = {
  value: any;
  expires: number;
};

export class MemoryStore implements CacheInterface {
  private store: Map<string, Entry> = new Map();

  get(key: string): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: any, ttl: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttl * 1000 });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  deleteByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }
}
