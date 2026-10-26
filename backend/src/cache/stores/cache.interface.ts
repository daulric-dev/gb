export interface CacheInterface {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl: number): Promise<void>;
  /**
   * Store `value` only when `key` is absent (or expired), atomically.
   * Resolves true when this call wrote it.
   */
  setIfAbsent(key: string, value: any, ttl: number): Promise<boolean>;
  /**
   * Atomically add one to the integer at `key` (missing counts as 0) and
   * return the new value. The TTL is set only when the key is created.
   */
  incr(key: string, ttl: number): Promise<number>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
}
