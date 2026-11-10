/**
 * Saved copies of what a student reads (course pages, module lists, work
 * instructions, the work list), so the app can show them without a signal.
 *
 * Pure logic over a small key/value backend: the app stores entries as files
 * (`offline-store.ts`), the tests keep them in memory. No React Native here.
 *
 * - Per account: every entry belongs to a scope (server + user id) and is only
 *   ever returned to that scope. The scope is checked against the entry's own
 *   record, not just its file name, so a hash collision can't leak data.
 * - Size cap with least-recently-used eviction: a read or write marks an entry
 *   as used; when a write would go over the cap, the entries used longest ago
 *   are removed first. An entry larger than the whole cap is not kept.
 * - Cleared on logout and server switch (`clearAll`), or per account.
 */

/** Where entries live. Synchronous so a write and its index stay in step. */
export interface KeyValueBackend {
  read(name: string): string | null;
  write(name: string, value: string): void;
  remove(name: string): void;
  /** Every stored name. */
  list(): string[];
}

/** An in-memory backend: tests, and web where there is no file system. */
export class MemoryBackend implements KeyValueBackend {
  private readonly items = new Map<string, string>();
  read(name: string) {
    return this.items.get(name) ?? null;
  }
  write(name: string, value: string) {
    this.items.set(name, value);
  }
  remove(name: string) {
    this.items.delete(name);
  }
  list() {
    return [...this.items.keys()];
  }
}

/** Whose data this is: the school server and the signed-in account. */
export interface CacheScope {
  server: string;
  userId: string;
}

export function scopeKey(scope: CacheScope): string {
  return `${scope.server.replace(/\/+$/, "")}\n${scope.userId}`;
}

/**
 * A short, file-name-safe hash (FNV-1a, two 32-bit lanes). Not for security:
 * names only need to be stable and spread out. Isolation is checked on read.
 */
export function hashKey(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

/** UTF-8 length of a string, which is what it takes on disk. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // a surrogate pair is one 4-byte character
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export interface CachedValue<T> {
  data: T;
  /** When the copy was saved (ms since epoch). */
  savedAt: number;
}

interface IndexEntry {
  /** Backend name of the entry. */
  name: string;
  scope: string;
  key: string;
  bytes: number;
  savedAt: number;
  lastUsed: number;
}

interface StoredEntry {
  scope: string;
  key: string;
  savedAt: number;
  data: unknown;
}

export const INDEX_NAME = "index.json";
/** 8 MB of JSON holds a great many pages and lists. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export interface OfflineCacheOptions {
  maxBytes?: number;
  now?: () => number;
}

export class OfflineCache {
  private index: IndexEntry[] | null = null;
  private readonly maxBytes: number;
  private readonly now: () => number;
  /** Strictly increasing use counter, so two uses in one millisecond still order. */
  private tick = 0;

  constructor(
    private readonly backend: KeyValueBackend,
    options: OfflineCacheOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = options.now ?? Date.now;
  }

  private entryName(scope: string, key: string): string {
    return `e_${hashKey(`${scope}\u0000${key}`)}.json`;
  }

  private loadIndex(): IndexEntry[] {
    if (this.index) return this.index;
    let parsed: IndexEntry[] = [];
    try {
      const raw = this.backend.read(INDEX_NAME);
      const value = raw ? JSON.parse(raw) : [];
      if (Array.isArray(value)) parsed = value.filter(isIndexEntry);
    } catch {
      parsed = [];
    }
    // Entries the index lost track of (a crash between writes) are dropped,
    // so the size cap always covers everything on disk.
    const known = new Set(parsed.map((e) => e.name));
    for (const name of this.backend.list()) {
      if (name !== INDEX_NAME && !known.has(name)) this.safeRemove(name);
    }
    this.tick = parsed.reduce((max, e) => Math.max(max, e.lastUsed), 0);
    this.index = parsed;
    return parsed;
  }

  private saveIndex(): void {
    this.backend.write(INDEX_NAME, JSON.stringify(this.index ?? []));
  }

  private safeRemove(name: string) {
    try {
      this.backend.remove(name);
    } catch {
      /* already gone */
    }
  }

  private nextUse(): number {
    this.tick = Math.max(this.tick + 1, this.now());
    return this.tick;
  }

  /** The saved copy for this account, or null. Marks it as recently used. */
  get<T>(scope: CacheScope, key: string): CachedValue<T> | null {
    const scopeId = scopeKey(scope);
    const index = this.loadIndex();
    const entry = index.find((e) => e.scope === scopeId && e.key === key);
    if (!entry) return null;
    let stored: StoredEntry | null = null;
    try {
      const raw = this.backend.read(entry.name);
      stored = raw ? (JSON.parse(raw) as StoredEntry) : null;
    } catch {
      stored = null;
    }
    // Belt and braces: the record itself must name this account and key.
    if (!stored || stored.scope !== scopeId || stored.key !== key) {
      this.dropEntry(entry);
      return null;
    }
    entry.lastUsed = this.nextUse();
    this.saveIndex();
    return { data: stored.data as T, savedAt: stored.savedAt };
  }

  /** Save (or replace) a copy for this account, evicting old copies to fit. */
  put(scope: CacheScope, key: string, data: unknown): void {
    const scopeId = scopeKey(scope);
    const savedAt = this.now();
    const value = JSON.stringify({ scope: scopeId, key, savedAt, data });
    const bytes = utf8Bytes(value);
    const index = this.loadIndex();
    const existing = index.find((e) => e.scope === scopeId && e.key === key);
    if (existing) this.dropEntry(existing, false);
    if (bytes > this.maxBytes) {
      this.saveIndex();
      return;
    }
    this.evictToFit(bytes);
    const name = this.entryName(scopeId, key);
    this.backend.write(name, value);
    this.index!.push({
      name,
      scope: scopeId,
      key,
      bytes,
      savedAt,
      lastUsed: this.nextUse(),
    });
    this.saveIndex();
  }

  remove(scope: CacheScope, key: string): void {
    const scopeId = scopeKey(scope);
    const entry = this.loadIndex().find(
      (e) => e.scope === scopeId && e.key === key,
    );
    if (entry) this.dropEntry(entry);
  }

  private dropEntry(entry: IndexEntry, persist = true) {
    this.safeRemove(entry.name);
    this.index = this.loadIndex().filter((e) => e !== entry);
    if (persist) this.saveIndex();
  }

  private evictToFit(incoming: number) {
    const index = this.loadIndex();
    let total = index.reduce((sum, e) => sum + e.bytes, 0);
    if (total + incoming <= this.maxBytes) return;
    const byAge = [...index].sort((a, b) => a.lastUsed - b.lastUsed);
    const evicted = new Set<IndexEntry>();
    for (const entry of byAge) {
      if (total + incoming <= this.maxBytes) break;
      this.safeRemove(entry.name);
      evicted.add(entry);
      total -= entry.bytes;
    }
    this.index = index.filter((e) => !evicted.has(e));
  }

  /** Bytes and entries stored, for one account or for everyone. */
  usage(scope?: CacheScope): { bytes: number; entries: number } {
    const scopeId = scope ? scopeKey(scope) : null;
    const entries = this.loadIndex().filter(
      (e) => scopeId === null || e.scope === scopeId,
    );
    return {
      bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      entries: entries.length,
    };
  }

  /** Keys saved for this account, most recently used first. */
  keys(scope: CacheScope): string[] {
    const scopeId = scopeKey(scope);
    return this.loadIndex()
      .filter((e) => e.scope === scopeId)
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .map((e) => e.key);
  }

  /** Forget one account's copies. */
  clearScope(scope: CacheScope): void {
    const scopeId = scopeKey(scope);
    const index = this.loadIndex();
    for (const entry of index) {
      if (entry.scope === scopeId) this.safeRemove(entry.name);
    }
    this.index = index.filter((e) => e.scope !== scopeId);
    this.saveIndex();
  }

  /** Forget everything: logout and server switch. */
  clearAll(): void {
    for (const name of this.backend.list()) this.safeRemove(name);
    this.index = [];
    this.tick = 0;
  }
}

function isIndexEntry(value: unknown): value is IndexEntry {
  const e = value as IndexEntry;
  return (
    !!e &&
    typeof e.name === "string" &&
    typeof e.scope === "string" &&
    typeof e.key === "string" &&
    typeof e.bytes === "number" &&
    typeof e.savedAt === "number" &&
    typeof e.lastUsed === "number"
  );
}
