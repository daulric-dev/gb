# Realtime (`src/realtime`)

The plumbing for live updates: a publish/subscribe bus and an "who is online" presence tracker. Features that stream events to clients over Server-Sent Events (chat, live attendance) publish to the bus, and every API instance holding an open SSE connection for that channel receives the event and forwards it.

With Redis enabled (`USE_REDIS=true` and `REDIS_URL` set) the bus uses Redis `PUBLISH`/`SUBSCRIBE`, so events reach connections on every replica, and presence is stored in Redis keys. Without Redis both fall back to in-process state, which is correct for a single instance only: a second replica would not see the first one's events or online users.

## What it provides

- **HTTP routes** - none. The SSE endpoints that use this module belong to the features (`src/chat`, `src/attendance`).
- **Services / exports** - `RealtimeModule` is `@Global()` and exports:
  - `RedisPubSubService`
    - `publish(channel, payload)` - JSON-serialises and publishes (Redis) or delivers straight to local handlers (in-process). Publish errors are logged, not thrown.
    - `subscribe(channel, handler)` - registers a local handler; the first handler on a channel subscribes the Redis connection. Returns an unsubscribe function; the last unsubscribe on a channel drops the Redis subscription.
    - One handler throwing never stops delivery to the others. Malformed payloads from Redis are dropped with a warning.
  - `PresenceService`
    - `connect(userId, schoolId)` - counts one more SSE connection for the user and publishes `{ type: 'presence', data: { userId, online: true, at } }` on the user's **first** connection.
    - `heartbeat(userId, schoolId)` - refreshes the user's 60-second TTL (Redis mode only; in-process presence lasts until disconnect).
    - `disconnect(userId, schoolId)` - counts one connection fewer and publishes `online: false` when it was the last.
    - `onlineUserIds(schoolId)` - users online in a school; in Redis mode entries older than 60 s are pruned first.
    - `subscribeSchool(schoolId, handler)` - subscribe to a school's presence events.
- **Other** - `redis.util.ts` exports `redisEnabled()` and `redisConnectionOptions()` (host, port, credentials and TLS from `REDIS_URL`, reconnect with backoff up to 2 s). Only the two services above use it; `src/queue` and `src/cache` parse `REDIS_URL` themselves.

Redis keys and channels used by presence: `presence:count:<userId>` (connection counter with TTL), `presence:online:<schoolId>` (sorted set scored by last-seen time) and channel `presence:school:<schoolId>`.

## Used by

- `src/app.module.ts` imports `RealtimeModule`.
- `src/chat/chat-realtime.service.ts` wraps `RedisPubSubService` with chat's own channel names; `chat-realtime.service.test.ts` builds a real in-process `RedisPubSubService`.
- `src/chat/chat.controller.ts` injects `PresenceService`: its SSE stream calls `connect`, `heartbeat` and `disconnect` and forwards `subscribeSchool` events, and `GET /api/chat/presence` returns `onlineUserIds(schoolId)`.
- `src/attendance/attendance.realtime.ts` injects `RedisPubSubService` for the live attendance feed.

## Depends on

- `ioredis` (Redis mode). No other Nest modules.

## Data

No database tables. In Redis mode, the keys and channels listed above.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `USE_REDIS` | unset | `true` (with `REDIS_URL`) switches both services to Redis. |
| `REDIS_URL` | unset | `redis://user:pass@host:port`; `rediss://` turns on TLS. Port defaults to 6379. |

## Files

| File | Purpose |
| --- | --- |
| `realtime.module.ts` | Global module providing and exporting both services. |
| `redis-pubsub.service.ts` | `RedisPubSubService`: the shared pub/sub bus (separate publisher and subscriber connections). |
| `presence.service.ts` | `PresenceService`: per-user connection counting and per-school online lists. In-process mode serialises updates so concurrent connects do not double-broadcast. |
| `redis.util.ts` | `redisEnabled()` and `redisConnectionOptions()`. |
| `redis-pubsub.service.test.ts` | In-process bus: delivery, channel isolation, unsubscribe, fan-out, cleanup on destroy. |
| `presence.service.test.ts` | In-process presence: first connection broadcasts once, offline only on the last disconnect, users tracked independently, concurrent connects broadcast once. |

## Tests

```bash
cd backend && bun test src/realtime
```

The tests run in in-process mode (no Redis needed).

## See also

- [docs/content/backend/chat.md](../../../docs/content/backend/chat.md)
- [src/chat/README.md](../chat/README.md), [src/attendance/README.md](../attendance/README.md), [src/queue/README.md](../queue/README.md)
