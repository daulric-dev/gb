# Cache stores (`src/cache/stores`)

This folder holds the storage back ends behind `CacheService`. Every store implements `CacheInterface` (`get`, `set`, `setIfAbsent`, `incr`, `delete`, `deleteByPrefix`, `clear`, all async, with `ttl` in seconds). A store can also have an optional `dispose()`, which `CacheService.onModuleDestroy()` calls. Only `../cache.service.ts` imports from this folder, through `./stores` (`index.ts`).

## Files

| File | Defines |
|------|---------|
| `cache.interface.ts` | `CacheInterface`, the contract every store implements. `index.ts` re-exports it as the type `CacheStore`. |
| `MemoryStore.ts` | `MemoryStore`: an in-process `Map` with per-entry expiry. A read of an expired entry deletes it, and a sweep every 60 seconds purges the rest (the timer is `unref`'d so it does not keep the process alive). It does **LRU eviction**: reads and writes move a key to the end of the map, and when the store grows past `maxEntries` (default 10,000; a constructor argument) the oldest keys are dropped. Values are stored by reference, not copied. `dispose()` stops the sweep and empties the map. |
| `RedisStore.ts` | `RedisStore`: built on Bun's `RedisClient`. Values are `JSON.stringify`'d and stored with `SET ... EX ttl`. `deleteByPrefix` runs a `SCAN` loop with `MATCH prefix*` and `COUNT 100`, deleting each batch. `clear` runs `FLUSHALL ASYNC`. `setIfAbsent` is `SET ... NX EX`; `incr` is an `EVAL` script doing `INCR` plus `EXPIRE` on creation, so both are atomic across API instances. It sends a `PING` every 60 seconds to keep the connection alive. `dispose()` stops the ping and closes the client. |
| `index.ts` | Barrel file: exports `MemoryStore`, `RedisStore` and the type `CacheStore`. |
| `MemoryStore.test.ts` | Tests for `MemoryStore`: a miss returns null, round trip, TTL expiry, `delete`, `deleteByPrefix` keeping keys that do not match, and `clear`. |

## How the parent uses them

The `CacheService` constructor picks `new RedisStore(new RedisClient(process.env.REDIS_URL, …))` when `USE_REDIS === 'true'`, and `new MemoryStore()` otherwise. All service code goes through `CacheService`, which catches errors from the store, so a store can let errors propagate.

## Adding a new store

1. Create `<Name>Store.ts` that exports a class implementing `CacheInterface` from `./cache.interface`:
   - `get` returns `null` on a miss (never `undefined`);
   - `set` honours `ttl` in **seconds**;
   - `deleteByPrefix` removes every key that starts with the prefix;
   - if the store holds timers or connections, add a `dispose()` that releases them.
2. Export it from `index.ts`.
3. Choose it in the `CacheService` constructor (`../cache.service.ts`), usually behind a new environment flag like `USE_REDIS`, and log which store is in use the way the existing branches do.
4. Add a `<Name>Store.test.ts` next to it that mirrors `MemoryStore.test.ts`, then run `cd backend && bun test src/cache`.
