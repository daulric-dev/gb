import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  RedisThrottlerStorage,
  THROTTLE_KEY_PREFIX,
  THROTTLE_LUA_SHA,
  createThrottlerStorage,
  type ThrottleRedisClient,
} from './redis-throttler.storage';

/**
 * Fake Redis that runs the throttle script's logic against an in-memory map
 * with a controllable clock. It mirrors the Lua in redis-throttler.storage.ts
 * (PTTL / GET / INCR / PEXPIRE / SET PX), so these tests pin the storage's
 * contract; the real script is smoke-tested against a live Redis separately.
 */
function fakeRedis() {
  let now = 1_000_000;
  const store = new Map<string, { value: number; expiresAt: number }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e && e.expiresAt <= now) store.delete(k);
    return store.get(k);
  };
  const pttl = (k: string) => {
    const e = live(k);
    return e ? e.expiresAt - now : -2;
  };
  let scriptLoaded = false;

  const run = (
    _numKeys: number,
    hitsKey: string,
    blockKey: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ) => {
    const blockTtl = pttl(blockKey);
    if (blockTtl > 0) {
      const hitsTtl = pttl(hitsKey);
      return [
        live(hitsKey)?.value ?? 0,
        hitsTtl < 0 ? blockTtl : hitsTtl,
        1,
        blockTtl,
      ];
    }
    const e = live(hitsKey) ?? { value: 0, expiresAt: now + ttl };
    e.value++;
    store.set(hitsKey, e);
    const hitsTtl = e.expiresAt - now;
    if (e.value > limit) {
      store.set(blockKey, { value: 1, expiresAt: now + blockDuration });
      e.expiresAt = now + blockDuration;
      return [e.value, blockDuration, 1, blockDuration];
    }
    return [e.value, hitsTtl, 0, 0];
  };

  const client = {
    evalsha: mock(async (sha: string, ...args: any[]) => {
      expect(sha).toBe(THROTTLE_LUA_SHA);
      if (!scriptLoaded) throw new Error('NOSCRIPT No matching script.');
      return (run as any)(...args);
    }),
    eval: mock(async (_script: string, ...args: any[]) => {
      scriptLoaded = true;
      return (run as any)(...args);
    }),
    quit: mock(async () => 'OK'),
  };
  return {
    client,
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const TTL = 60_000;

describe('RedisThrottlerStorage', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    redis = fakeRedis();
    storage = new RedisThrottlerStorage(
      redis.client as unknown as ThrottleRedisClient,
    );
  });

  afterEach(async () => {
    await storage.onModuleDestroy();
  });

  test('counts hits per key and reports the window in seconds', async () => {
    const a1 = await storage.increment('default:a', TTL, 3, TTL, 'default');
    const a2 = await storage.increment('default:a', TTL, 3, TTL, 'default');
    const b1 = await storage.increment('default:b', TTL, 3, TTL, 'default');

    expect(a1).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(a2.totalHits).toBe(2);
    expect(b1.totalHits).toBe(1);
  });

  test('uses prefixed, same-slot keys', async () => {
    await storage.increment('default:a', TTL, 3, TTL, 'default');
    expect([...redis.store.keys()]).toEqual([
      `${THROTTLE_KEY_PREFIX}{default:a}:hits`,
    ]);
  });

  test('loads the script with EVAL on NOSCRIPT, then uses EVALSHA', async () => {
    await storage.increment('k', TTL, 3, TTL, 'default');
    await storage.increment('k', TTL, 3, TTL, 'default');
    expect(redis.client.eval).toHaveBeenCalledTimes(1);
    expect(redis.client.evalsha).toHaveBeenCalledTimes(2);
  });

  test('the window expires after ttl and counting restarts', async () => {
    await storage.increment('k', TTL, 3, TTL, 'default');
    redis.advance(30_500);
    const mid = await storage.increment('k', TTL, 3, TTL, 'default');
    expect(mid.totalHits).toBe(2);
    expect(mid.timeToExpire).toBe(30); // ceil(29.5 s)

    redis.advance(30_000);
    const fresh = await storage.increment('k', TTL, 3, TTL, 'default');
    expect(fresh.totalHits).toBe(1);
    expect(fresh.timeToExpire).toBe(60);
  });

  test('blocks once the limit is passed and does not count blocked hits', async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        (await storage.increment('k', TTL, 3, 120_000, 'default')).isBlocked,
      ).toBe(false);
    }
    const over = await storage.increment('k', TTL, 3, 120_000, 'default');
    expect(over).toMatchObject({
      totalHits: 4,
      isBlocked: true,
      timeToBlockExpire: 120,
    });

    redis.advance(10_000);
    const still = await storage.increment('k', TTL, 3, 120_000, 'default');
    expect(still).toMatchObject({
      totalHits: 4,
      isBlocked: true,
      timeToBlockExpire: 110,
    });
  });

  test('a fresh window starts when the block lifts', async () => {
    for (let i = 0; i < 4; i++) {
      await storage.increment('k', TTL, 3, 5_000, 'default');
    }
    redis.advance(5_000);
    const after = await storage.increment('k', TTL, 3, 5_000, 'default');
    expect(after).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  test('falls back to in-memory counting on Redis errors, still enforcing the limit', async () => {
    const down = {
      evalsha: mock(async () => {
        throw new Error('Connection is closed.');
      }),
      eval: mock(async () => {
        throw new Error('unreachable');
      }),
      quit: mock(async () => 'OK'),
    };
    let clock = 0;
    const s = new RedisThrottlerStorage(
      down as unknown as ThrottleRedisClient,
      () => clock,
    );
    const warn = mock(() => undefined);
    (s as any).logger.warn = warn;

    const results: Awaited<ReturnType<typeof s.increment>>[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(await s.increment('k', TTL, 2, TTL, 'default'));
    }
    expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3]);
    expect(results[2].isBlocked).toBe(true);
    // Not a NOSCRIPT error: no EVAL retry.
    expect(down.eval).not.toHaveBeenCalled();
    // Warned once, not per request.
    expect(warn).toHaveBeenCalledTimes(1);

    clock += 60_000;
    await s.increment('other', TTL, 2, TTL, 'default');
    expect(warn).toHaveBeenCalledTimes(2);
    expect((warn.mock.calls[1] as unknown[])[0]).toContain(
      '2 more since last warning',
    );
    await s.onModuleDestroy();
  });

  test('falls back on a malformed script reply', async () => {
    const odd = {
      evalsha: mock(async () => 'OK'),
      eval: mock(async () => 'OK'),
      quit: mock(async () => 'OK'),
    };
    const s = new RedisThrottlerStorage(odd as unknown as ThrottleRedisClient);
    (s as any).logger.warn = () => undefined;
    expect((await s.increment('k', TTL, 5, TTL, 'default')).totalHits).toBe(1);
    await s.onModuleDestroy();
  });

  test('onModuleDestroy closes the client once', async () => {
    await storage.onModuleDestroy();
    await storage.onModuleDestroy();
    expect(redis.client.quit).toHaveBeenCalledTimes(1);
  });
});

describe('createThrottlerStorage', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.USE_REDIS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.USE_REDIS;
    else process.env.USE_REDIS = saved;
  });

  test('is undefined without USE_REDIS, so the library default storage is used', () => {
    process.env.USE_REDIS = 'false';
    expect(createThrottlerStorage()).toBeUndefined();
  });
});
