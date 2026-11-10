import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import {
  MemoryBackend,
  OfflineCache,
  scopeKey,
  type CacheScope,
  type KeyValueBackend,
} from "@/lib/offline-cache";
import {
  MemoryQueueStore,
  SyncQueue,
  type QueueStore,
  type QueuedDraft,
} from "@/lib/sync-queue";

/**
 * Where offline data lives on the device, and who it belongs to.
 *
 * Drafts (`drafts.json`, sync-queue.ts) and the last profile (`profile.json`,
 * so the app can open offline) are under `<documents>/offline-data/`, which
 * the OS never purges: unsent quiz answers must not vanish. Saved copies are
 * re-downloadable, so they live in `<caches>/offline-reads/` (one JSON file
 * each plus an index; see offline-cache.ts). Web keeps it all in memory.
 *
 * The scope is the server plus the signed-in account. Only students get one:
 * staff screens never read or write offline data.
 *
 * Cleared like the opened-files cache (open-file.ts): everything on logout and
 * server switch (`clearOfflineData`); saved copies and the profile, but not
 * that account's drafts, when the server ends the session (`clearOfflineReads`).
 */

const native = Platform.OS !== "web";

function rootDir(): Directory {
  return new Directory(Paths.document, "offline-data");
}

function readsDir(): Directory {
  return new Directory(Paths.cache, "offline-reads");
}

/** One file per name in a folder, written synchronously. */
class FileBackend implements KeyValueBackend {
  constructor(private readonly dir: () => Directory) {}

  private file(name: string): File {
    return new File(this.dir(), name);
  }

  read(name: string): string | null {
    try {
      const file = this.file(name);
      return file.exists ? file.textSync() : null;
    } catch {
      return null;
    }
  }

  write(name: string, value: string): void {
    const dir = this.dir();
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, name);
    if (!file.exists) file.create();
    file.writeSync(value);
  }

  remove(name: string): void {
    const file = this.file(name);
    if (file.exists) file.delete();
  }

  list(): string[] {
    try {
      const dir = this.dir();
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((entry): entry is File => entry instanceof File)
        .map((file) => file.name);
    } catch {
      return [];
    }
  }
}

class FileQueueStore implements QueueStore {
  private readonly backend = new FileBackend(rootDir);
  load(): QueuedDraft[] {
    const raw = this.backend.read("drafts.json");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }
  save(items: QueuedDraft[]): void {
    try {
      this.backend.write("drafts.json", JSON.stringify(items));
    } catch (err) {
      console.warn("Could not save offline drafts", err);
    }
  }
}

const readsBackend: KeyValueBackend = native
  ? new FileBackend(readsDir)
  : new MemoryBackend();

export const offlineCache = new OfflineCache(readsBackend);
export const draftQueue = new SyncQueue(
  native ? new FileQueueStore() : new MemoryQueueStore(),
);

// ── scope ───────────────────────────────────────────────────────────────────

let scope: CacheScope | null = null;
const scopeListeners = new Set<() => void>();

/** Set by OfflineProvider from the signed-in profile (students only). */
export function setOfflineScope(next: CacheScope | null): void {
  const changed =
    (scope ? scopeKey(scope) : null) !== (next ? scopeKey(next) : null);
  scope = next;
  if (changed) for (const listener of scopeListeners) listener();
}

export function offlineScope(): CacheScope | null {
  return scope;
}

/** The scope as the queue keys it, or null when offline data is off. */
export function offlineScopeKey(): string | null {
  return scope ? scopeKey(scope) : null;
}

export function subscribeOfflineScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => scopeListeners.delete(listener);
}

// ── the profile, so a student can open the app offline ──────────────────────

const profileStore: KeyValueBackend = native
  ? new FileBackend(rootDir)
  : new MemoryBackend();

export function rememberProfile(server: string, profile: unknown): void {
  try {
    profileStore.write(
      "profile.json",
      JSON.stringify({ server, profile, savedAt: Date.now() }),
    );
  } catch {
    /* best effort */
  }
}

/** The profile last seen on this server, or null. */
export function savedProfile<T>(server: string): T | null {
  try {
    const raw = profileStore.read("profile.json");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { server?: string; profile?: T };
    return parsed.server === server && parsed.profile ? parsed.profile : null;
  } catch {
    return null;
  }
}

function forgetProfile() {
  try {
    profileStore.remove("profile.json");
  } catch {
    /* already gone */
  }
}

// ── clearing ────────────────────────────────────────────────────────────────

/**
 * Saved copies and the remembered profile go; drafts stay, keyed to their
 * account, so a student whose session expired gets them back on signing in
 * again. Never throws.
 */
export function clearOfflineReads(): void {
  try {
    offlineCache.clearAll();
    if (native) {
      const dir = readsDir();
      if (dir.exists) dir.delete();
    }
  } catch (err) {
    console.warn("Could not clear saved copies", err);
  }
  forgetProfile();
}

/**
 * Everything: saved copies, drafts and the profile. Logout and server switch,
 * so the next person on this device finds nothing of the previous account.
 * Never throws.
 */
export function clearOfflineData(): void {
  clearOfflineReads();
  try {
    draftQueue.clearAll();
  } catch (err) {
    console.warn("Could not clear offline drafts", err);
  }
  if (native) {
    try {
      const dir = rootDir();
      if (dir.exists) dir.delete();
    } catch (err) {
      console.warn("Could not clear offline data", err);
    }
    draftQueue.reset();
  }
  setOfflineScope(null);
}

/** For the settings screen: what this account keeps on the device. */
export function offlineUsage(): {
  bytes: number;
  copies: number;
  unsentDrafts: number;
} {
  const usage = scope ? offlineCache.usage(scope) : { bytes: 0, entries: 0 };
  const key = offlineScopeKey();
  return {
    bytes: usage.bytes,
    copies: usage.entries,
    unsentDrafts: key ? draftQueue.unsent(key).length : 0,
  };
}
