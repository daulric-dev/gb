process.env.USE_REDIS = 'false';

import { describe, test, expect, beforeEach } from 'bun:test';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  test('get/set round-trip', async () => {
    await cache.set('key', { items: [1, 2, 3] }, 60);
    expect(await cache.get('key')).toEqual({ items: [1, 2, 3] });
  });

  test('update returns false if key does not exist', async () => {
    const result = await cache.update('missing', (v: number) => v + 1, 60);
    expect(result).toBe(false);
  });

  test('update transforms cached value in-place', async () => {
    await cache.set('list', [1, 2], 60);
    const result = await cache.update<number[]>('list', (v) => [...v, 3], 60);
    expect(result).toBe(true);
    expect(await cache.get('list')).toEqual([1, 2, 3]);
  });

  test('update works with async transformer function', async () => {
    await cache.set('count', 10, 60);
    const result = await cache.update<number>('count', async (v) => v * 2, 60);
    expect(result).toBe(true);
    expect(await cache.get('count')).toBe(20);
  });

  test('update preserves TTL behavior', async () => {
    await cache.set('temp', 'original', 0.01);
    await cache.update<string>('temp', (v) => v + '-updated', 0.01);
    await new Promise((r) => setTimeout(r, 20));
    expect(await cache.get('temp')).toBeNull();
  });

  test('delete removes key', async () => {
    await cache.set('x', 'value', 60);
    await cache.delete('x');
    expect(await cache.get('x')).toBeNull();
  });

  test('deleteByPrefix removes matching keys', async () => {
    await cache.set('session:1', 'a', 60);
    await cache.set('session:2', 'b', 60);
    await cache.set('config:theme', 'dark', 60);

    await cache.deleteByPrefix('session:');

    expect(await cache.get('session:1')).toBeNull();
    expect(await cache.get('session:2')).toBeNull();
    expect(await cache.get('config:theme')).toBe('dark');
  });
});
