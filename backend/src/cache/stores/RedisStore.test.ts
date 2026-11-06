import { afterEach, describe, expect, test } from 'bun:test';
import { CACHE_KEY_PREFIX, RedisStore } from './RedisStore';

/**
 * A stand-in for Bun's RedisClient over a plain Map: enough of GET/SET/DEL,
 * SCAN MATCH and the two `send` commands the store uses, and it records every
 * command so a test can assert nothing like FLUSHALL is ever sent.
 */
function fakeRedis(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const sent: string[] = [];
  const match = (pattern: string, key: string) =>
    key.startsWith(pattern.replace(/\*$/, ''));
  const client = {
    data,
    sent,
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => {
      data.set(key, value);
      return 'OK';
    },
    del: async (...keys: string[]) => {
      let n = 0;
      for (const key of keys) if (data.delete(key)) n++;
      return n;
    },
    // Two pages, so the cursor loop is exercised.
    scan: async (cursor: string, _m: string, pattern: string) => {
      const keys = [...data.keys()].filter((k) => match(pattern, k)).sort();
      return cursor === '0' ? ['1', keys.slice(0, 1)] : ['0', keys];
    },
    send: async (command: string, args: string[]) => {
      sent.push(command);
      if (command === 'SET') {
        if (args.includes('NX') && data.has(args[0])) return null;
        data.set(args[0], args[1]);
        return 'OK';
      }
      if (command === 'EVAL') {
        const key = args[2];
        const value = Number(data.get(key) ?? 0) + 1;
        data.set(key, String(value));
        return value;
      }
      return 'PONG';
    },
    close: () => {},
  };
  return client;
}

let stores: RedisStore[] = [];
afterEach(() => {
  for (const s of stores) s.dispose();
  stores = [];
});

function storeOver(redis: ReturnType<typeof fakeRedis>) {
  const store = new RedisStore(redis as any);
  stores.push(store);
  return store;
}

describe('RedisStore key namespace', () => {
  test('stores and reads every key under the cache prefix', async () => {
    const redis = fakeRedis();
    const store = storeOver(redis);

    await store.set('profile:1', { a: 1 }, 60);
    await store.setIfAbsent('once:1', true, 60);
    await store.incr('count:1', 60);

    expect([...redis.data.keys()].sort()).toEqual([
      `${CACHE_KEY_PREFIX}count:1`,
      `${CACHE_KEY_PREFIX}once:1`,
      `${CACHE_KEY_PREFIX}profile:1`,
    ]);
    expect(await store.get('profile:1')).toEqual({ a: 1 });

    await store.delete('profile:1');
    expect(await store.get('profile:1')).toBeNull();
  });

  test('deleteByPrefix stays inside the cache namespace', async () => {
    const redis = fakeRedis({ 'profile:x': 'outside' });
    const store = storeOver(redis);
    await store.set('profile:1', 1, 60);
    await store.set('profile:2', 2, 60);
    await store.set('session:1', 3, 60);

    await store.deleteByPrefix('profile:');

    expect([...redis.data.keys()].sort()).toEqual([
      `${CACHE_KEY_PREFIX}session:1`,
      'profile:x',
    ]);
  });

  test('clear removes only cache keys, never queues or rate limits', async () => {
    const redis = fakeRedis({
      'bull:files:1': 'job',
      'throttle:{ip}:hits': '3',
    });
    const store = storeOver(redis);
    await store.set('a', 1, 60);
    await store.set('b', 2, 60);

    await store.clear();

    expect([...redis.data.keys()].sort()).toEqual([
      'bull:files:1',
      'throttle:{ip}:hits',
    ]);
    expect(redis.sent).not.toContain('FLUSHALL');
    expect(redis.sent).not.toContain('FLUSHDB');
  });
});
