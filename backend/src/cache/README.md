# Cache (`src/cache`)

This module is the backend's key-value cache. Services use it to keep hot reads out of Postgres: profiles, sessions, permissions, lists of academic years, and so on. `CacheService` is a thin wrapper that chooses one of two stores when the app starts:

- **Redis**, when `USE_REDIS=true` (Bun's built-in `RedisClient`), so the cache is shared across replicas;
- otherwise an **in-process memory store** with LRU eviction.

Every call is error-tolerant. A store failure is logged and treated as a cache miss (`get` returns `null`, `update` returns `false`), so a cache outage never fails a request.

## What it provides

### HTTP routes

None.

### Services / exports

`CacheModule` is `@Global()` and exports **`CacheService`**, so any provider can inject it without importing the module.

| Method | What it does |
|--------|--------------|
| `get(key)` | Returns the cached value, or `null` on a miss or an error. |
| `set(key, value, ttl)` | Stores a value. **`ttl` is in seconds.** |
| `update<T>(key, fn, ttl)` | Read-modify-write: when the key exists, stores `await fn(value)` and returns `true`. A missing key returns `false` and nothing is written, so a cold cache is never seeded with partial data. This is not atomic across replicas. |
| `delete(key)` | Removes one key. |
| `deleteByPrefix(prefix)` | Removes every key that starts with `prefix`. In Redis this is a `SCAN MATCH prefix*` loop, 100 keys per batch. |
| `clear()` | Removes everything. In Redis this is `FLUSHALL ASYNC`, which empties the **whole** Redis database. |

When the module is destroyed (`onModuleDestroy`), `CacheService` disposes of the store, which stops its timers and closes the Redis connection.

### Other

- [`stores/`](./stores/README.md) contains `MemoryStore`, `RedisStore` and the `CacheInterface` they implement. `CacheService` itself also implements that interface.
- The key names are chosen by the calling services. Some examples: `session:<hash>` (account), `profile:<userId>` (auth), `academic-years:<schoolId>` (academic year), `announcements:content:<schoolId>` (announcement), `attendance:wrong-code:<sessionId>:<studentId>` (attendance).

## Used by

- `src/app.module.ts` imports `CacheModule`.
- `CacheService` is injected by:
  - `academic-year/academic-year.service.ts`;
  - `account/session.service.ts`;
  - `announcement/announcement.service.ts`;
  - `attendance/attendance.service.ts`;
  - `auth/auth.service.ts`;
  - `billing/subscriptions/subscription.service.ts`;
  - `course/course.service.ts`, `course/course-copy.service.ts`, `course/access/course-access.service.ts`;
  - `dashboard/dashboard.service.ts`;
  - `email-domain/email-domain.service.ts`;
  - `grade-scale/grade-scale.service.ts`;
  - `images/images.service.ts`;
  - `permission/permission.service.ts`, `permission/permission.guard.ts`, `permission/permission.effective.ts`;
  - `school/school.service.ts`;
  - `sso/sso.service.ts`;
  - `student-account/student-membership.service.ts`;
  - `student-portal/student.guard.ts`;
  - `student/student.service.ts`;
  - `term/term.service.ts`.

## Depends on

Nothing else in the app. It uses `RedisClient` from `bun` when Redis is enabled.

## Data

No database tables. Values are kept in Redis as JSON strings, or as plain objects in memory.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `USE_REDIS` | unset (memory store) | `true` selects `RedisStore`. |
| `REDIS_URL` | unset | The Redis connection URL, read when `USE_REDIS=true`. The client is created with `autoReconnect: true`, `maxRetries: 20` and `idleTimeout: 0`. |

The realtime pub/sub bus (`src/realtime/redis.util.ts`) reads the same two variables for its own connections.

## Files

| File | Purpose |
|------|---------|
| `cache.module.ts` | Global module that provides and exports `CacheService`. |
| `cache.service.ts` | `CacheService`: chooses the store, wraps every call with error handling and debug logging. |
| `stores/` | The store implementations. See [stores/README.md](./stores/README.md). |
| `cache.service.test.ts` | `CacheService` tests, run on the memory store. |

## Tests

```bash
cd backend && bun test src/cache
```

- `cache.service.test.ts` covers the get/set round trip, `update` (it returns false on a missing key, transforms the value, accepts an async transformer and keeps the TTL), `delete` and `deleteByPrefix`.
- `stores/MemoryStore.test.ts` covers the memory store directly.

## See also

- [docs/content/backend/cache.md](../../../docs/content/backend/cache.md)
- [stores/README.md](./stores/README.md)
- `src/realtime/` (Redis pub/sub, which is separate from the cache)
