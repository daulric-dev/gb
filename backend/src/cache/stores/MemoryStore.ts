import { CacheInterface } from './cache.interface';

type Entry = {
  value: any;
  expires: number;
};

const DEFAULT_MAX_ENTRIES = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

export class MemoryStore implements CacheInterface {
  private store: Map<string, Entry> = new Map();
  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.sweep = setInterval(() => this.purgeExpired(), SWEEP_INTERVAL_MS);
    this.sweep.unref?.();
  }

  dispose(): void {
    clearInterval(this.sweep);
    this.store.clear();
  }

  get(key: string): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    // Mark as most-recently-used for LRU eviction (Map keeps insertion order).
    this.store.delete(key);
    this.store.set(key, entry);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: any, ttl: number): Promise<void> {
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + ttl * 1000 });
    this.evictIfNeeded();
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

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key);
    }
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      // Oldest (least-recently-used) key is first in insertion order.
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
