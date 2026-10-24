import { mock, type Mock } from 'bun:test';

/** Methods every model delegate gets, with what they return by default. */
const DEFAULTS: Record<string, () => unknown> = {
  findUnique: () => null,
  findUniqueOrThrow: () => {
    throw new Error('Not found');
  },
  findFirst: () => null,
  findFirstOrThrow: () => {
    throw new Error('Not found');
  },
  findMany: () => [],
  count: () => 0,
  aggregate: () => ({}),
  groupBy: () => [],
  create: () => ({}),
  createMany: () => ({ count: 0 }),
  createManyAndReturn: () => [],
  update: () => ({}),
  updateMany: () => ({ count: 0 }),
  updateManyAndReturn: () => [],
  upsert: () => ({}),
  delete: () => ({}),
  deleteMany: () => ({ count: 0 }),
};

type AnyMock = Mock<(...args: any[]) => any>;
export type MockModel = Record<keyof typeof DEFAULTS, AnyMock>;

export type MockPrisma = Record<string, MockModel> & {
  $queryRaw: AnyMock;
  $executeRaw: AnyMock;
  $queryRawUnsafe: AnyMock;
  $executeRawUnsafe: AnyMock;
  $transaction: AnyMock;
  $connect: AnyMock;
  $disconnect: AnyMock;
};

/**
 * A stand-in for PrismaService in unit tests.
 *
 * Every `prisma.<model>.<method>` is a bun mock, created on first touch, that
 * resolves to a sensible empty result (null, [], 0). Set what a test needs:
 *
 *   const prisma = createMockPrisma();
 *   prisma.course.findUnique.mockResolvedValue({ id: 'c1', status: 'draft' });
 *   prisma.course.update.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
 *   ...
 *   expect(prisma.course.update.mock.calls[0][0].where).toEqual({ id: 'c1' });
 *
 * `$transaction` runs an interactive callback against the same mock, or
 * awaits an array of operations, so code using either form works unchanged.
 */
export function createMockPrisma(): MockPrisma {
  const models = new Map<string, MockModel>();

  const model = (name: string): MockModel => {
    let delegate = models.get(name);
    if (!delegate) {
      const created: Record<string, AnyMock> = {};
      for (const [method, fallback] of Object.entries(DEFAULTS)) {
        created[method] = mock(() => Promise.resolve().then(fallback));
      }
      delegate = created as MockModel;
      models.set(name, delegate);
    }
    return delegate;
  };

  const root: Record<string, unknown> = {
    $queryRaw: mock(() => Promise.resolve([])),
    $executeRaw: mock(() => Promise.resolve(0)),
    $queryRawUnsafe: mock(() => Promise.resolve([])),
    $executeRawUnsafe: mock(() => Promise.resolve(0)),
    $connect: mock(() => Promise.resolve(undefined)),
    $disconnect: mock(() => Promise.resolve(undefined)),
  };

  const proxy: MockPrisma = new Proxy(root, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      // Await-ability checks and the like must not look like models.
      if (prop === 'then') return undefined;
      return model(prop);
    },
  }) as MockPrisma;

  root.$transaction = mock((arg: unknown) =>
    typeof arg === 'function'
      ? Promise.resolve((arg as (tx: MockPrisma) => unknown)(proxy))
      : Promise.all(arg as Promise<unknown>[]),
  );

  return proxy;
}
