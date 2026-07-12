---
sidebar_label: 2026-07-12 · Online presence
sidebar_position: 5
---

# 2026-07-12 - Online presence

You can now see **who's online** in your school. A green dot shows on people in the conversation list and the new-message picker, and the open conversation header shows **Online / Offline** for the other person — updating live as people come and go. No migration.

## How it works

Presence rides on the chat realtime stream and the shared Redis pub/sub bus. A user is **online while they hold at least one open SSE stream** (any tab, device, or replica):

- The `/chat/stream` handler calls `PresenceService.connect` on open, `heartbeat` on each 25s ping, and `disconnect` on close.
- State is shared across replicas in Redis: a per-user connection counter (`INCR`/`DECR`, TTL-refreshed by the heartbeat) drives the online→offline transition — online is published on the first connection, offline on the last — and a per-school sorted set (scored by last-seen) answers `GET /chat/presence`.
- Each stream also subscribes to its **school** presence channel, so an online/offline change is broadcast to everyone in the school as a `presence` SSE frame.

Robustness: if a replica dies without a clean disconnect, the per-user counter's TTL lapses and the stale sorted-set entry is pruned on the next query; the frontend also re-fetches presence every 45s as a backstop. With `USE_REDIS` off, presence runs in-process (single replica).

## New service

`PresenceService` ([realtime/presence.service.ts](../../../../backend/src/realtime/presence.service.ts)) joins `RedisPubSubService` in the `@Global` `RealtimeModule`, and both now share `realtime/redis.util.ts` for connection options. New endpoint `GET /chat/presence` → `{ online: string[] }`. New `presence` event added to `ChatEventType`.

## Frontend

`lib/chat.ts` gained an `onlineUsers` signal, an `isOnline(userId)` helper, a `presence` SSE handler, and the 45s reconcile. A small `PresenceDot` / `AvatarPresenceDot` renders the indicator in `ConversationList`, `NewChatDialog`, and the `MessageThread` header.

## Tests

Added `realtime/presence.service.test.ts` — online on connect (broadcast once), no re-broadcast on a second connection, offline only on the last disconnect, and independent multi-user tracking. Backend suite: 252 → 256 tests, all passing.
