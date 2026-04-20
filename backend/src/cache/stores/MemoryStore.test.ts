import { describe, test, expect, beforeEach } from 'bun:test';
import { MemoryStore } from './MemoryStore';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  test('get returns null for missing key', async () => {
    expect(await store.get('nonexistent')).toBeNull();
  });

  test('set/get round-trip stores and retrieves value', async () => {
    await store.set('key', { name: 'test', count: 42 }, 60);
    expect(await store.get('key')).toEqual({ name: 'test', count: 42 });
  });

  test('TTL expiration removes entry', async () => {
    await store.set('ephemeral', 'gone-soon', 0.01);
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.get('ephemeral')).toBeNull();
  });

  test('delete removes a key', async () => {
    await store.set('a', 1, 60);
    await store.delete('a');
    expect(await store.get('a')).toBeNull();
  });

  test('deleteByPrefix removes matching keys but keeps others', async () => {
    await store.set('user:1', 'alice', 60);
    await store.set('user:2', 'bob', 60);
    await store.set('post:1', 'hello', 60);

    await store.deleteByPrefix('user:');

    expect(await store.get('user:1')).toBeNull();
    expect(await store.get('user:2')).toBeNull();
    expect(await store.get('post:1')).toBe('hello');
  });

  test('clear removes everything', async () => {
    await store.set('a', 1, 60);
    await store.set('b', 2, 60);
    await store.clear();

    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
  });
});
