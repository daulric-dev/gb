import { api, ApiError, isNetworkError } from "@/lib/api";
import { offlineCache, offlineScope } from "@/lib/offline-store";

export interface OfflineRead<T> {
  data: T;
  /** Set when the server could not be reached and a saved copy was used. */
  savedAt: number | null;
}

/**
 * GET with a saved copy to fall back on, for the student screens that work
 * offline (course pages, modules, work instructions, the work list).
 *
 * Online: the answer is returned and saved for this account. No answer at
 * all (offline, server unreachable): the saved copy, with when it was saved.
 * Anything else (403, 404...) is thrown as before, and a 403/404 drops the
 * copy so a removed page or a dropped course stops showing offline.
 * Without a scope (staff, signed out) it is a plain `api()` call.
 *
 * `toStore` trims what is written to the device, e.g. a lockdown quiz's
 * questions are never kept.
 */
export async function cachedGet<T>(
  path: string,
  toStore?: (data: T) => T,
): Promise<OfflineRead<T>> {
  const scope = offlineScope();
  if (!scope) return { data: await api<T>(path), savedAt: null };
  try {
    const data = await api<T>(path);
    try {
      offlineCache.put(scope, path, toStore ? toStore(data) : data);
    } catch (err) {
      console.warn("Could not save an offline copy", err);
    }
    return { data, savedAt: null };
  } catch (err) {
    if (isNetworkError(err)) {
      const saved = offlineCache.get<T>(scope, path);
      if (saved) return { data: saved.data, savedAt: saved.savedAt };
    } else if (
      err instanceof ApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      offlineCache.remove(scope, path);
    }
    throw err;
  }
}

/** Save a copy without reading it back (background prefetch). */
export async function saveForOffline<T>(
  path: string,
  toStore?: (data: T) => T,
): Promise<T | null> {
  try {
    return (await cachedGet<T>(path, toStore)).data;
  } catch {
    return null;
  }
}
