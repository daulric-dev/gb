
export async function expectRejection(
  promise: Promise<unknown>,
): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('Expected promise to reject, but it resolved');
}

export function createMockCacheService() {
  const store = new Map<string, { value: any; ttl: number }>();

  return {
    get: (key: string) => Promise.resolve(store.get(key)?.value ?? null),
    set: (key: string, value: any, ttl: number) => {
      store.set(key, { value, ttl });
      return Promise.resolve();
    },
    update: async <T>(
      key: string,
      func: (v: T) => T | Promise<T>,
      ttl: number,
    ) => {
      const entry = store.get(key);
      if (!entry) return false;
      store.set(key, { value: await func(entry.value as T), ttl });
      return true;
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    deleteByPrefix: (prefix: string) => {
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) store.delete(k);
      }
      return Promise.resolve();
    },
    clear: () => {
      store.clear();
      return Promise.resolve();
    },
    _store: store,
  };
}
