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
    getUserSchoolId: () =>
      Promise.resolve(overrides.userSchoolId ?? 'school-1'),
    _client: client,
    _builder: builder,
  };
}

/**
 * A Supabase mock that routes results per `schema.table` (or bare `table`),
 * records every query, and lets routes branch on the operation. Use this when
 * a single flow issues several different queries that must return different
 * results (the simple `createMockSupabaseService` returns one result for all).
 *
 * Route value can be a fixed `{ data, error }` or a function receiving the
 * captured call `{ schema, table, op, payload, filters }`.
 */
type RoutingCall = {
  schema: string;
  table: string | null;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload: any;
  filters: Record<string, unknown>;
};

type RouteValue =
  | QueryResult
  | ((call: RoutingCall) => QueryResult | Promise<QueryResult>);

export function createRoutingSupabase(
  config: {
    tables?: Record<string, RouteValue>;
    storage?: Record<string, any>;
    getUser?: () => any;
    userSchoolId?: string;
  } = {},
) {
  const calls: RoutingCall[] = [];

  function resolveRoute(state: RoutingCall) {
    calls.push({ ...state, filters: { ...state.filters } });
    const key = `${state.schema}.${state.table}`;
    const route = config.tables?.[key] ??
      (state.table ? config.tables?.[state.table] : undefined) ?? {
        data: null,
        error: null,
      };
    const result = typeof route === 'function' ? route(state) : route;
    return Promise.resolve(result);
  }

  function makeBuilder() {
    const state: RoutingCall = {
      schema: 'public',
      table: null,
      op: 'select',
      payload: null,
      filters: {},
    };
    const builder: any = {};
    builder.schema = (s: string) => ((state.schema = s), builder);
    builder.from = (t: string) => ((state.table = t), builder);
    builder.select = () => builder;
    builder.insert = (p: any) => (
      (state.op = 'insert'),
      (state.payload = p),
      builder
    );
    builder.update = (p: any) => (
      (state.op = 'update'),
      (state.payload = p),
      builder
    );
    builder.upsert = (p: any) => (
      (state.op = 'upsert'),
      (state.payload = p),
      builder
    );
    builder.delete = () => ((state.op = 'delete'), builder);
    builder.eq = (col: string, val: unknown) => (
      (state.filters[col] = val),
      builder
    );
    for (const m of [
      'neq',
      'in',
      'ilike',
      'or',
      'not',
      'order',
      'limit',
      'range',
    ]) {
      builder[m] = () => builder;
    }
    builder.single = () => resolveRoute(state);
    builder.maybeSingle = () => resolveRoute(state);
    builder.then = (resolve: Function, reject?: Function) =>
      resolveRoute(state).then(resolve as any, reject as any);
    return builder;
  }

  const client: any = {
    from: (t: string) => makeBuilder().from(t),
    schema: (s: string) => ({
      from: (t: string) => makeBuilder().schema(s).from(t),
    }),
    storage: {
      from: () => config.storage ?? {},
    },
  };

  return {
    getServiceClient: () => client,
    createUserClient: () => client,
    getUser: config.getUser ?? (() => Promise.resolve(null)),
    getUserSchoolId: () => Promise.resolve(config.userSchoolId ?? 'school-1'),
    _calls: calls,
    _client: client,
  };
}

/**
 * Await a promise expected to reject and return the thrown value, so callers
 * can assert on it: `expect(await expectRejection(p)).toBeInstanceOf(X)`.
 * Awaits a real promise (unlike bun's `expect(p).rejects`, which is not typed
 * as thenable and trips `@typescript-eslint/await-thenable`).
 */
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
