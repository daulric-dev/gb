# Throttle (`src/throttle`)

How rate-limit buckets are keyed and where their counters live. The limits themselves are configured in `src/app.module.ts` with `@nestjs/throttler`; this folder holds the functions that decide **who** a request counts against, and the Redis storage that makes the counters shared across API replicas.

Two rules drive it:

- **Client IP comes only from Fastify's `req.ip`.** `X-Forwarded-For` and `X-Real-IP` are never read directly, because clients can set them. Fastify resolves `req.ip` through `trustProxy`, which `src/createApp.ts` sets to trust `TRUST_PROXY_HOPS` hops (default 1, the bundled Caddy).
- **A signed-in session gets its own bucket**, keyed on the `gb_session` cookie - but only if the cookie looks like a token this server issued (`isIssuedSessionToken()`, a tag check with no database lookup). The throttler runs before `AuthGuard`, so without that check a client could rotate made-up cookies to get a fresh bucket per request. The bucket key is a truncated SHA-256 fingerprint, never the token.

## What it provides

- **HTTP routes** - none.
- **Exports** (`tracker.ts`, plain functions, not a Nest module):
  - `getClientIp(req)` - `req.ip`, or undefined.
  - `getSessionTracker(req)` - `s:<fingerprint>` for an issued session cookie, else undefined.
  - `fingerprint(value)` - first 22 characters of the base64url SHA-256.
  - `ThrottlerReq` - the request shape the trackers read (`body.email`, `headers`, `cookies`, `ip`).
- **Exports** (`redis-throttler.storage.ts`, `throttle-storage.module.ts`):
  - `RedisThrottlerStorage` - a `ThrottlerStorage` (`increment(key, ttl, limit, blockDuration, throttlerName)`) backed by Redis.
  - `createThrottlerStorage()` - a `RedisThrottlerStorage` when `USE_REDIS=true` and `REDIS_URL` is set, else `undefined`.
  - `ThrottleStorageModule` / `THROTTLER_SHARED_STORAGE` - provides that value to `ThrottlerModule.forRootAsync` and owns the connection (closed in `onModuleDestroy`).

## Used by

`src/app.module.ts` is the only importer. It registers the storage through `ThrottlerModule.forRootAsync` (importing `ThrottleStorageModule`) and four named throttlers (limits are per window; development limits are 100 000 so local work is never throttled):

| Throttler | Window | Production limit | Tracker |
| --- | --- | --- | --- |
| `default` | 60 s | 1 200 | session (`getSessionTracker`), else `ip:<getClientIp>` |
| `auth-strict` | 1 h | 10 000 | `getEmailIpTracker`: the body's `email` (fingerprinted) plus the client IP, else IP alone. Only on routes that name it. |
| `auth-ip` | 1 h | 10 000 | `ip:<getClientIp>`. Only on routes that name it. |
| `claim-code` | 15 min | 10 000 | session, else IP |

`default` and `claim-code` apply to every route through the global `ThrottlerGuard`; `auth-strict` and `auth-ip` only to routes (or controllers) that name them in `@Throttle()` (`skipUnlessDeclared`), so per-IP sign-in limits never throttle a school behind one NAT address elsewhere; individual routes lower the limits with `@Throttle({ '<name>': { limit, ttl } })`. Storage keys are `default:<tracker>` for the default throttler and `<name>:<Controller>.<handler>:<tracker>` for the others, so a per-route override only counts calls to that route. Current overrides:

- `src/auth/auth.controller.ts` - `auth-strict` on `otp/send` (5/h) and `otp/verify` (10 per 15 min), `auth-ip` on the same (300/h, 600 per 15 min), `claim-code` on `join-school`, `default` on account deletion (3/h).
- `src/sso/sso.controller.ts` - `auth-ip` on `discover`, `saml/acs`, `:provider/start`, `handoff`.
- `claim-code` on guessable codes: `src/student-portal/student-portal.controller.ts` (course join), `src/email-domain/email-domain.controller.ts`, `src/attendance/portal-attendance.controller.ts`, `src/attendance/scan-claim.controller.ts`.

## Depends on

- `SESSION_COOKIE` and `isIssuedSessionToken()` from `src/account/session.service.ts`.
- `node:crypto`.
- `ioredis` and `redisEnabled()` / `redisConnectionOptions()` from `src/realtime/redis.util.ts`; `ThrottlerStorageService` from `@nestjs/throttler` for the fallback.

## Data

- **Without Redis** counters live in `@nestjs/throttler`'s default in-memory storage, so each API instance counts separately (fine for one instance; N replicas would allow N times the limit).
- **With Redis** (`USE_REDIS=true`, `REDIS_URL`) every replica shares two keys per bucket: `throttle:{<storage key>}:hits` (fixed-window counter, expires after the throttler's `ttl`) and `throttle:{<storage key>}:block` (set for `blockDuration`, which defaults to `ttl`, once the limit is passed). The braces are a hash tag so both keys share a Redis Cluster slot. One Lua script, `throttle.lua` (`EVALSHA`, loaded with `EVAL` on `NOSCRIPT`) increments, sets expiry and blocks atomically. While blocked, requests are not counted; when the block lifts a fresh window starts, as in the in-memory storage. Times come back in whole seconds, rounded up, like the library's.
- **Redis failure at request time** (down, timeout, bad reply): that call is counted in a per-process in-memory storage instead, so limiting stays on (per replica) and requests do not fail. A warning is logged at most once a minute with the number of suppressed failures. The client is created with `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` and `commandTimeout: 500` so an outage costs a request at most about 500 ms rather than queueing it; it reconnects in the background (`redisConnectionOptions()` from `src/realtime/redis.util.ts`).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `TRUST_PROXY_HOPS` | `1` | Read by `src/createApp.ts`: how many proxies Fastify trusts when computing `req.ip`. Set it to the real number of proxies in front of the API, or every client shares one bucket (too few) or clients can spoof their IP (too many). |
| `NODE_ENV` | - | Read by `src/app.module.ts`: `production` selects the production limits. |
| `USE_REDIS` | unset | `true` (with `REDIS_URL`) stores counters in Redis, shared by all replicas. |
| `REDIS_URL` | unset | `redis://user:pass@host:port`; `rediss://` turns on TLS. Parsed by `src/realtime/redis.util.ts`. |

## Files

| File | Purpose |
| --- | --- |
| `tracker.ts` | The tracker functions above. |
| `redis-throttler.storage.ts` | `RedisThrottlerStorage`, loads the Lua script, `createThrottlerStorage()`. |
| `throttle.lua` | The atomic counter and block script (copied into `dist` by `nest-cli.json` assets). |
| `throttle-storage.module.ts` | `ThrottleStorageModule`, which provides the storage (or `undefined`) and closes its client on shutdown. |
| `redis-throttler.storage.test.ts` | Tests with a fake Redis: per-key hit counting, prefixed keys, `EVAL` on `NOSCRIPT` then `EVALSHA`, window expiry, blocking after the limit without counting blocked hits, a fresh window after the block, in-memory fallback on errors and bad replies (limit still enforced, warning rate-limited), idempotent shutdown, no Redis storage without `USE_REDIS`. |
| `tracker.test.ts` | Tests: uses `req.ip`, ignores client-sent proxy headers, undefined when nothing identifies the client, keys issued session cookies by session, made-up or tampered cookies get no bucket, never leaks the token, ignores bearer headers and other cookies. |

## Tests

```bash
cd backend && bun test src/throttle
```

## See also

- [src/account/README.md](../account/README.md) (session tokens), [src/README.md](../README.md) (request flow)
- [docs/content/environment-variables.md](../../../docs/content/environment-variables.md)
