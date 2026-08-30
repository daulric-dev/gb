import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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
