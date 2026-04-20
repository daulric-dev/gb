type QueryResult = { data: any; error: any };

export function createMockQueryBuilder(result: QueryResult = { data: null, error: null }) {
  const builder: any = {};
  const methods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'ilike', 'or', 'not',
    'order', 'limit', 'range',
    'schema', 'from',
  ];

  for (const m of methods) {
    builder[m] = (..._args: any[]) => builder;
  }

  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: Function) => resolve(result);

  return builder;
}

export function createMockSupabaseService(overrides: Record<string, any> = {}) {
  const defaultResult = { data: null, error: null };
  const builder = createMockQueryBuilder(overrides.queryResult ?? defaultResult);

  const client = {
    from: (_table: string) => builder,
    schema: (_schema: string) => ({ from: (_table: string) => builder }),
    auth: {
      signInWithOtp: async () => overrides.authResult ?? defaultResult,
      verifyOtp: async () => overrides.verifyResult ?? defaultResult,
      refreshSession: async () => overrides.refreshResult ?? defaultResult,
      admin: {
        deleteUser: async () => overrides.deleteUserResult ?? defaultResult,
        signOut: async () => overrides.signOutResult ?? defaultResult,
      },
    },
    storage: {
      from: () => ({
        upload: async () => overrides.uploadResult ?? defaultResult,
        download: async () => overrides.downloadResult ?? defaultResult,
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
    get: async (key: string) => store.get(key)?.value ?? null,
    set: async (key: string, value: any, ttl: number) => { store.set(key, { value, ttl }); },
    update: async <T>(key: string, func: (v: T) => T | Promise<T>, ttl: number) => {
      const entry = store.get(key);
      if (!entry) return false;
      store.set(key, { value: await func(entry.value), ttl });
      return true;
    },
    delete: async (key: string) => { store.delete(key); },
    deleteByPrefix: async (prefix: string) => {
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    },
    clear: async () => { store.clear(); },
    _store: store,
  };
}