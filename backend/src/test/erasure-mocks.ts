import { mock } from 'bun:test';

/**
 * An in-memory StorageService: put/get/getBuffer/exists/delete/listKeys over
 * a Map. Set `failDelete` (or `failPut`) to make those calls reject, to test
 * partial failures.
 */
export function createFakeStorage(initial: Record<string, string> = {}) {
  const objects = new Map<string, Buffer>(
    Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]),
  );
  const fake = {
    objects,
    failDelete: false,
    failPut: false,
    put: mock(async (key: string, body: Buffer | Uint8Array | string) => {
      if (fake.failPut) throw new Error('storage down');
      objects.set(key, Buffer.from(body as string));
    }),
    getBuffer: mock(async (key: string) => objects.get(key) ?? null),
    exists: mock(async (key: string) =>
      objects.has(key) ? { size: objects.get(key)!.length, contentType: null } : null,
    ),
    delete: mock(async (keys: string | string[]) => {
      if (fake.failDelete) throw new Error('storage down');
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    }),
    listKeys: mock(
      async (prefix: string, opts: { endBefore?: string } = {}) =>
        [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .filter((k) => !opts.endBefore || k < opts.endBefore)
          .sort(),
    ),
  };
  return fake;
}

/**
 * A stand-in for ErasureLogService for services whose own tests are not
 * about the log: `record` resolves an id and remembers the client it was
 * called with (`calls[i].db`) and its input.
 */
export function createMockErasureLog() {
  const calls: { db: unknown; input: any }[] = [];
  return {
    calls,
    record: mock(async (db: unknown, input: any) => {
      calls.push({ db, input });
      return `log-${calls.length}`;
    }),
    removeObjects: mock(async () => 0),
    exportPending: mock(async () => 0),
    prune: mock(async () => ({ rows: 0, objects: 0 })),
  };
}
