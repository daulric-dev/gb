import { describe, expect, test } from "bun:test";
import {
  INDEX_NAME,
  MemoryBackend,
  OfflineCache,
  hashKey,
  utf8Bytes,
  type CacheScope,
} from "./offline-cache";

const alice: CacheScope = { server: "https://school.example.com/api", userId: "alice" };
const bob: CacheScope = { server: "https://school.example.com/api", userId: "bob" };
const otherServer: CacheScope = { server: "https://other.example.com/api", userId: "alice" };

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("OfflineCache", () => {
  test("stores and returns a copy with when it was saved", () => {
    const c = clock();
    const cache = new OfflineCache(new MemoryBackend(), { now: c.now });
    cache.put(alice, "/portal/me/activities", [{ id: "a1" }]);
    c.advance(500);
    expect(cache.get(alice, "/portal/me/activities")).toEqual({
      data: [{ id: "a1" }],
      savedAt: 1_000,
    });
    expect(cache.get(alice, "/missing")).toBeNull();
  });

  test("never returns another account's or another server's copy", () => {
    const cache = new OfflineCache(new MemoryBackend());
    cache.put(alice, "/portal/me/courses", ["alice's"]);
    expect(cache.get(bob, "/portal/me/courses")).toBeNull();
    expect(cache.get(otherServer, "/portal/me/courses")).toBeNull();
    cache.put(bob, "/portal/me/courses", ["bob's"]);
    expect(cache.get(alice, "/portal/me/courses")?.data).toEqual(["alice's"]);
    expect(cache.get(bob, "/portal/me/courses")?.data).toEqual(["bob's"]);
  });

  test("an entry whose record names another account is not served", () => {
    const backend = new MemoryBackend();
    const cache = new OfflineCache(backend);
    cache.put(alice, "/page", "secret");
    // Tamper: rewrite the file as if it belonged to bob.
    const name = backend.list().find((n) => n !== INDEX_NAME)!;
    const record = JSON.parse(backend.read(name)!);
    backend.write(name, JSON.stringify({ ...record, scope: "x\nbob" }));
    expect(cache.get(alice, "/page")).toBeNull();
    // ...and it is dropped.
    expect(cache.usage().entries).toBe(0);
  });

  test("evicts the least recently used copies to stay under the cap", () => {
    const c = clock();
    const one = JSON.stringify({ scope: "", key: "", savedAt: 0, data: "x".repeat(100) });
    const cap = utf8Bytes(one) * 3 + 200;
    const cache = new OfflineCache(new MemoryBackend(), { maxBytes: cap, now: c.now });
    cache.put(alice, "a", "x".repeat(100));
    c.advance(1);
    cache.put(alice, "b", "x".repeat(100));
    c.advance(1);
    cache.put(alice, "c", "x".repeat(100));
    c.advance(1);
    // Reading "a" makes "b" the oldest.
    expect(cache.get(alice, "a")).not.toBeNull();
    c.advance(1);
    cache.put(alice, "d", "x".repeat(100));
    expect(cache.get(alice, "b")).toBeNull();
    expect(cache.get(alice, "a")).not.toBeNull();
    expect(cache.get(alice, "c")).not.toBeNull();
    expect(cache.get(alice, "d")).not.toBeNull();
    expect(cache.usage().bytes).toBeLessThanOrEqual(cap);
  });

  test("orders uses within the same millisecond", () => {
    const one = JSON.stringify({ scope: "", key: "", savedAt: 0, data: "y".repeat(50) });
    const cap = utf8Bytes(one) * 2 + 150;
    const cache = new OfflineCache(new MemoryBackend(), { maxBytes: cap, now: () => 5 });
    cache.put(alice, "a", "y".repeat(50));
    cache.put(alice, "b", "y".repeat(50));
    cache.get(alice, "a");
    cache.put(alice, "c", "y".repeat(50));
    expect(cache.keys(alice).sort()).toEqual(["a", "c"]);
  });

  test("does not keep a copy larger than the whole cap", () => {
    const cache = new OfflineCache(new MemoryBackend(), { maxBytes: 300 });
    cache.put(alice, "small", "ok");
    cache.put(alice, "huge", "z".repeat(1_000));
    expect(cache.get(alice, "huge")).toBeNull();
    expect(cache.get(alice, "small")?.data).toBe("ok");
  });

  test("replacing a copy does not double count it", () => {
    const cache = new OfflineCache(new MemoryBackend());
    cache.put(alice, "k", "first");
    const before = cache.usage();
    cache.put(alice, "k", "again");
    expect(cache.usage()).toEqual(before);
    expect(cache.get(alice, "k")?.data).toBe("again");
  });

  test("survives a restart: the index is read back from the backend", () => {
    const backend = new MemoryBackend();
    new OfflineCache(backend).put(alice, "k", { a: 1 });
    const reopened = new OfflineCache(backend);
    expect(reopened.get(alice, "k")?.data).toEqual({ a: 1 });
  });

  test("drops files the index lost track of", () => {
    const backend = new MemoryBackend();
    backend.write("e_orphan.json", "{}");
    const cache = new OfflineCache(backend);
    expect(cache.usage().entries).toBe(0);
    expect(backend.list()).not.toContain("e_orphan.json");
  });

  test("clearAll (logout, server switch) removes every account's copies", () => {
    const backend = new MemoryBackend();
    const cache = new OfflineCache(backend);
    cache.put(alice, "a", 1);
    cache.put(bob, "b", 2);
    cache.clearAll();
    expect(cache.get(alice, "a")).toBeNull();
    expect(cache.get(bob, "b")).toBeNull();
    expect(backend.list()).toEqual([]);
    // Usable afterwards.
    cache.put(alice, "a", 3);
    expect(cache.get(alice, "a")?.data).toBe(3);
  });

  test("clearScope removes only that account", () => {
    const cache = new OfflineCache(new MemoryBackend());
    cache.put(alice, "a", 1);
    cache.put(bob, "b", 2);
    cache.clearScope(alice);
    expect(cache.get(alice, "a")).toBeNull();
    expect(cache.get(bob, "b")?.data).toBe(2);
    expect(cache.usage(alice)).toEqual({ bytes: 0, entries: 0 });
    expect(cache.usage(bob).entries).toBe(1);
  });

  test("a corrupt index starts empty instead of failing", () => {
    const backend = new MemoryBackend();
    backend.write(INDEX_NAME, "not json");
    const cache = new OfflineCache(backend);
    expect(cache.get(alice, "a")).toBeNull();
    cache.put(alice, "a", 1);
    expect(cache.get(alice, "a")?.data).toBe(1);
  });
});

describe("helpers", () => {
  test("hashKey is stable and file-name safe", () => {
    expect(hashKey("abc")).toBe(hashKey("abc"));
    expect(hashKey("abc")).not.toBe(hashKey("abd"));
    expect(hashKey("anything")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("utf8Bytes counts multi-byte characters", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
    expect(utf8Bytes("😀")).toBe(4);
  });
});
