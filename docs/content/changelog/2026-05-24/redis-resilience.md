---
sidebar_label: 2026-05-24 · Redis resilience
sidebar_position: 3
---

# 2026-05-24 — Redis resilience against Upstash idle disconnects

## Problem

In production, `AuthService.getProfile` was returning `User profile not found` (404) for users whose profiles existed. Logs showed the underlying error: `RedisError [ERR_REDIS_CONNECTION_CLOSED]: Connection has failed`. Two issues stacked:

1. Upstash closes idle TCP connections after a few minutes. Bun's `RedisClient` reconnects, but commands in-flight when the socket drops (or arriving during the reconnect window) fail immediately with `ERR_REDIS_CONNECTION_CLOSED`. This is unlike `ioredis`, which queues commands during reconnects and hid the issue.
2. `getProfile`'s catch block converted *any* thrown error into `NotFoundException`, so Redis failures masqueraded as missing profiles.

## Fix

- `CacheService` now swallows all store errors. A Redis outage degrades to "always miss, never write" instead of throwing — reads fall through to Supabase, writes silently skip.
  - `get` / `update` on store error → log + treat as cache miss (return `null` / `false`).
  - `set` / `delete` / `deleteByPrefix` / `clear` on store error → log + no-op.
- `RedisStore` sends a `PING` every 60s to prevent Upstash from closing the socket, and is constructed with `autoReconnect: true`, `maxRetries: 20`, `idleTimeout: 0`.
- `CacheService` implements `OnModuleDestroy` to tear down the keepalive interval and close the Redis socket on shutdown.
- `AuthService.getProfile` no longer wraps non-domain errors. Only Supabase row-not-found produces `NotFoundException`; everything else surfaces as a real 500.

## Operational notes

- `REDIS_URL` must use `rediss://` (TLS) for Upstash.
- Watch logs for sustained `Redis keepalive ping failed` warnings — sporadic ones during reconnect are expected, sustained failures indicate credentials/URL/network issues.
- If `ERR_REDIS_CONNECTION_CLOSED` continues to appear after this fix, consider migrating `RedisStore` to `@upstash/redis` (HTTPS, no persistent socket). The `CacheInterface` abstraction makes this a single-file change.

See the [Cache module docs](../../backend/cache.md) for the full architecture and the [Resilience](../../backend/cache.md#resilience) section for the error-handling contract.
