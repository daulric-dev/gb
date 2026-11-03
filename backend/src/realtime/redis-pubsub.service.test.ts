import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { RedisPubSubService } from './redis-pubsub.service';

// Force in-process mode so the bus delivers locally and needs no Redis server,
// regardless of USE_REDIS in the ambient environment.
describe('RedisPubSubService (in-process)', () => {
  let bus: RedisPubSubService;
  let savedUseRedis: string | undefined;

  beforeEach(() => {
    savedUseRedis = process.env.USE_REDIS;
    process.env.USE_REDIS = 'false';
    bus = new RedisPubSubService();
    bus.onModuleInit();
  });

  afterEach(() => {
    if (savedUseRedis === undefined) delete process.env.USE_REDIS;
    else process.env.USE_REDIS = savedUseRedis;
  });

  test('delivers a published payload to a subscriber', async () => {
    const received: unknown[] = [];
    await bus.subscribe('c1', (p) => received.push(p));

    await bus.publish('c1', { hello: 'world' });

    expect(received).toEqual([{ hello: 'world' }]);
  });

  test('does not deliver to other channels', async () => {
    const received: unknown[] = [];
    await bus.subscribe('c1', (p) => received.push(p));

    await bus.publish('c2', { nope: true });

    expect(received).toHaveLength(0);
  });

  test('unsubscribe stops delivery', async () => {
    const received: unknown[] = [];
    const unsub = await bus.subscribe('c1', (p) => received.push(p));

    unsub();
    await bus.publish('c1', { after: 'unsub' });

    expect(received).toHaveLength(0);
  });

  test('fans out to every handler on a channel', async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    await bus.subscribe('c1', (p) => a.push(p));
    await bus.subscribe('c1', (p) => b.push(p));

    await bus.publish('c1', { x: 1 });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test('clears handler registrations on destroy to prevent stale subscriptions', async () => {
    await bus.subscribe('c1', () => undefined);
    await bus.subscribe('c2', () => undefined);

    await bus.onModuleDestroy();

    expect((bus as any).handlers.size).toBe(0);
  });
});

// Redis mode with a fake subscriber connection, to drive the ordering of
// SUBSCRIBE replies by hand.
describe('RedisPubSubService (subscribe races)', () => {
  function setup() {
    const bus = new RedisPubSubService();
    let resolveSubscribe!: () => void;
    const subscriber = {
      subscribe: mock(
        () =>
          new Promise<void>((resolve) => {
            resolveSubscribe = resolve;
          }),
      ),
      unsubscribe: mock(async () => undefined),
    };
    (bus as any).subscriber = subscriber;
    const deliver = (payload: unknown) => (bus as any).deliver('c1', payload);
    return { bus, subscriber, deliver, resolve: () => resolveSubscribe() };
  }

  test('a join + leave while the first SUBSCRIBE is in flight does not orphan it', async () => {
    const { bus, subscriber, deliver, resolve } = setup();
    const a: unknown[] = [];

    const pendingA = bus.subscribe('c1', (p) => a.push(p));
    const pendingB = bus.subscribe('c1', () => undefined);
    // One SUBSCRIBE, shared by both callers.
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);

    resolve();
    const [, unsubB] = await Promise.all([pendingA, pendingB]);
    unsubB();

    deliver({ n: 1 });
    expect(a).toEqual([{ n: 1 }]);
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();
    expect((bus as any).handlers.get('c1').size).toBe(1);
  });

  test('a leave racing a subscribe never empties the channel under it', async () => {
    const { bus, subscriber, deliver, resolve } = setup();
    const a: unknown[] = [];
    // B is already subscribed, then A joins and B leaves before A settles.
    const b = bus.subscribe('c1', () => undefined);
    resolve();
    const unsubB = await b;
    const pendingA = bus.subscribe('c1', (p) => a.push(p));
    unsubB();
    await pendingA;
    deliver('x');
    expect(a).toEqual(['x']);
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();
  });

  test('a failed SUBSCRIBE is retried by the next subscriber', async () => {
    const bus = new RedisPubSubService();
    const subscriber = {
      subscribe: mock()
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue(undefined),
      unsubscribe: mock(async () => undefined),
    };
    (bus as any).subscriber = subscriber;
    await bus.subscribe('c1', () => undefined);
    await bus.subscribe('c1', () => undefined);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);
  });

  test('the last leave drops the Redis subscription', async () => {
    const { bus, subscriber, resolve } = setup();
    const pending = bus.subscribe('c1', () => undefined);
    resolve();
    (await pending)();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith('c1');
    expect((bus as any).subscriptions.size).toBe(0);
  });
});
