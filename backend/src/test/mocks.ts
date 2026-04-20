type QueryResult = { data: any; error: any };

export function createMockQueryBuilder(
  result: QueryResult = { data: null, error: null },
) {
  const builder: any = {};
  const methods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'ilike',
    'or',
    'not',
    'order',
    'limit',
    'range',
    'schema',
    'from',
  ];

  for (const m of methods) {
    builder[m] = () => builder;
  }

  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: Function) => resolve(result);

  return builder;
}

export function createMockSupabaseService(overrides: Record<string, any> = {}) {
  const defaultResult = { data: null, error: null };
  const builder = createMockQueryBuilder(
    overrides.queryResult ?? defaultResult,
  );

  const client = {
    from: () => builder,
    schema: () => ({ from: () => builder }),
    auth: {
      signInWithOtp: () =>
        Promise.resolve(overrides.authResult ?? defaultResult),
      verifyOtp: () => Promise.resolve(overrides.verifyResult ?? defaultResult),
      refreshSession: () =>
        Promise.resolve(overrides.refreshResult ?? defaultResult),
      admin: {
        deleteUser: () =>
          Promise.resolve(overrides.deleteUserResult ?? defaultResult),
        signOut: () =>
          Promise.resolve(overrides.signOutResult ?? defaultResult),
      },
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve(overrides.uploadResult ?? defaultResult),
        download: () =>
          Promise.resolve(overrides.downloadResult ?? defaultResult),
      }),
    },
  };

  return {
    getServiceClient: () => client,
    createUserClient: () => client,
    _client: client,
    _builder: builder,
  };
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
