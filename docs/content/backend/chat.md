---
sidebar_label: Chat
---

# Chat Module

**Location**: `backend/src/chat/`

Real-time direct messaging between users in the same school. Any active member can message any other active member; messages are delivered live over **Server-Sent Events (SSE)**, fanned out across the stateless backend replicas by **Redis pub/sub**. The same surface renders **system messages** — a shared file or a class invitation arrive in the relevant DM as a message with an inline action button.

Postgres (Supabase) is the source of truth for every message. Redis is only a fan-out bus, so nothing is lost if Redis restarts (prod runs it with `--appendonly no`).

## Files

| File | Purpose |
|------|---------|
| `chat.module.ts` | `@Global` module; wires the controller and three services, exports `ChatService` + `ChatSystemService` |
| `chat.controller.ts` | `/chat` REST surface + the `GET /chat/stream` SSE endpoint |
| `chat.service.ts` | Conversations, messages, read state, unread counts, membership checks; the shared `postMessage` path |
| `chat-system.service.ts` | Bridges other features in as system messages (file share, class invite) |
| `chat-realtime.service.ts` | Maps chat events onto per-user pub/sub channels (thin layer over `RedisPubSubService`) |
| `message-cipher.service.ts` | AES-256-GCM encryption of message content at rest (versioned keyring) |
| `chat.constants.ts` | Channel naming, SSE event names, the channels feature flag |

The Redis pub/sub transport itself is a **shared, generic service**, not chat-specific:

| File | Purpose |
|------|---------|
| `realtime/redis-pubsub.service.ts` | `RedisPubSubService` — `publish(channel, payload)` / `subscribe(channel, handler)` over a dedicated ioredis publisher + subscriber, with an in-process fallback. Reusable by any feature (`RealtimeModule` is `@Global`). |
| `realtime/presence.service.ts` | `PresenceService` — tracks who is online (per-user connection count + per-school online set in Redis), broadcasts online/offline over the bus, and answers `onlineUserIds(schoolId)`. |
| `realtime/redis.util.ts` | Shared `REDIS_URL` connection options + `redisEnabled()`. |
| `chat.types.ts` | Shared response/event shapes |
| `dto/` | Request validation (create conversation, send message, message action, list query, create channel) |

## Message encryption at rest

Message content is encrypted before it is stored and decrypted on read, so a database dump, a leaked backup, or a direct SQL read yields ciphertext. This is **defense-in-depth** on top of TLS in transit and Supabase's disk encryption — it is **not** end-to-end: the server holds the key (it must, to render previews, unread, system messages, and SSE), the same trust already placed in this backend for grades and PII.

- **`MessageCipher`** ([message-cipher.service.ts](../../../../backend/src/chat/message-cipher.service.ts)) encrypts with **AES-256-GCM** (random 12-byte IV per message, GCM auth tag). Hooked at exactly three points: `ChatService.postMessage` and `editMessage` encrypt the `body` before write; `presentMessage` decrypts on the way out — which covers every read path, including conversation-list previews.
- **Envelope** (stored in the existing `body` column, no schema change): `enc:v<version>:<iv_b64>:<tag_b64>:<ciphertext_b64>`. A value without the `enc:` prefix is treated as **legacy plaintext and passed through**, so enabling encryption doesn't break rows already in the DB.
- **Keys** are base64 of 32 bytes, from the environment, and **versioned for rotation**: `CHAT_ENCRYPTION_KEY` (single → v1) or `CHAT_ENCRYPTION_KEYS` (`1:<b64>,2:<b64>`). New rows encrypt with the current version; old rows decrypt by the version tag in their envelope. See [Environment Variables](../environment-variables.md).
- **Fail-closed:** in production a missing key **stops the app from booting** (never silently store plaintext). In dev, a missing key logs a warning and passes through. A tampered ciphertext fails GCM auth and yields no plaintext (never the raw bytes).

Scope: message **body** is encrypted (this includes system-message captions, e.g. the shared file's name). System-message `metadata` keeps ids (`fileId`, `classId`) as plaintext — they're needed for navigation and aren't message content. The Redis bus carries decrypted events between the app and its SSE edges (internal, transient); the encryption boundary is the database.

## Data model

Migration: `supabase/migrations/20260712120000_chat.sql`, schema `chat`.

| Table | Key columns | Notes |
|-------|-------------|-------|
| `conversation` | `type` (`direct`/`channel`), `title`, `direct_key`, `last_message_at` | `direct_key` is the canonical `least(a):greatest(b)` of the two member ids; a unique partial index on `(school_id, direct_key) WHERE type='direct'` makes a DM exist **at most once** |
| `conversation_member` | `conversation_id`, `user_id`, `role`, `last_read_at` | `last_read_at` is the unread high-water mark; unique on `(conversation_id, user_id)` |
| `message` | `sender_id`, `type`, `body`, `metadata` (jsonb), `action_state` | `type` is `text` / `file_share` / `class_invite` / `system`; `action_state` (`pending`/`accepted`/`dismissed`, nullable) tracks an actionable system message |

**RLS** is enabled on all three tables as defense-in-depth (the API writes/reads via the service role): a user may only see a conversation, its membership, and its messages if they are a member, scoped to their school via `get_user_school_id()`.

> After applying the migration, regenerate types with `bun db:types` so `database.types.ts` includes the `chat` schema.

## Realtime: SSE + Redis pub/sub

The transport has to satisfy three constraints: **3 stateless replicas behind nginx with no sticky sessions**, **cookie-based auth**, and a **Cloudflare Worker entrypoint that cannot hold a streaming response**.

```
 browser ──EventSource──►  nginx  ──►  replica N (app1|app2|app3)
   ▲                                        │ subscribes chat:u:<me>
   │ SSE frames                             ▼
   └──────────────────────────────  Redis pub/sub  ◄── any replica PUBLISHes
```

1. The client opens `GET /chat/stream`. The request lands on one replica; `AuthGuard` authenticates it from the session cookie.
2. That replica **subscribes to the user's Redis channel** `chat:u:<userId>` for the life of the connection and relays every event it receives as an SSE frame (`event: <type>\ndata: <json>`). A `: ping` heartbeat every 25s keeps the connection and any proxy alive.
3. Sending goes over the normal `POST` routes. `ChatService.postMessage` writes the row, bumps `last_message_at`, marks the sender read, and **publishes** one event to each participant's channel.
4. Redis delivers that event to whichever replica currently holds each participant's SSE stream — no sticky sessions needed. `RedisPubSubService` reference-counts local handlers so a channel is subscribed while ≥1 local stream wants it and unsubscribed when the last disconnects.

**Two layers.** `RedisPubSubService` (`realtime/`) is the generic transport — `publish`/`subscribe` over Redis with an in-process fallback. `ChatRealtimeService` is a thin chat-specific layer that maps a user id to a `chat:u:<id>` channel. New realtime features publish/subscribe on the same bus.

**Fallback.** When `USE_REDIS` is not `true`, the bus dispatches in-process only (correct for single-process dev). `ioredis` is used (not Bun's `RedisClient`) because a subscriber connection must be dedicated to pub/sub.

**SSE frames emitted:** `message`, `conversation`, `read`, `message_action`, `presence` (see `ChatEventType`).

### Presence (who's online)

A user is **online while they hold ≥1 open SSE stream** (any tab/device/replica). The stream handler drives `PresenceService`:

- on connect → `presence.connect(userId, schoolId)`; on each 25s heartbeat → `presence.heartbeat(...)`; on close → `presence.disconnect(...)`.
- each stream also subscribes to its **school** presence channel (`presence:school:<schoolId>`) and relays online/offline changes as `presence` SSE frames, so everyone in the school updates live.

State is shared across replicas in Redis: a per-user connection counter (`presence:count:<userId>`, `INCR`/`DECR`, TTL-refreshed by the heartbeat) drives the online/offline **transition** (publish on 1st connect, on last disconnect), and a per-school sorted set (`presence:online:<schoolId>`, scored by last-seen) answers `GET /chat/presence`. If a replica dies without a clean disconnect, the counter TTL lapses and the stale sorted-set entry is pruned on the next query — and the frontend reconciles presence every 45s as a backstop. With `USE_REDIS` off it all runs in-process.

> **CORS on the stream.** `GET /chat/stream` calls `reply.hijack()` to own the socket, which **skips Fastify's onSend hooks — including the global CORS plugin**. The handler therefore writes `Access-Control-Allow-Origin` (the exact `FRONTEND_URL`, never `*`) and `Access-Control-Allow-Credentials: true` itself. Without this the browser blocks the cross-origin `EventSource` (frontend and API are different origins) and **no events are delivered** — the symptom is "messages only appear after you click into the conversation," because only the on-open fetch runs.

> The SSE endpoint requires the long-lived Node deployment (`infrastructure/docker-compose.yml`). It does **not** work on the Worker entrypoint (`worker.ts`), which replays requests through `fastify.inject()` and cannot stream. The frontend degrades to polling if the stream can't be established.

## REST API

All routes are under `/chat`, guarded by `AuthGuard` + `PermissionGuard` and require the `chat:*` catalog permissions (granted to `admin`, `teacher`, and `member` by default; ownership of a given message is enforced per-row in the service).

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/chat/stream` | `chat:read` | SSE event stream (see above) |
| `GET` | `/chat/users` | `chat:read` | Active users in your school you can message |
| `GET` | `/chat/presence` | `chat:read` | `{ online: string[] }` — user ids currently online in your school |
| `GET` | `/chat/unread-count` | `chat:read` | `{ count }` total unread, for the sidebar badge |
| `GET` | `/chat/conversations` | `chat:read` | Your conversations, newest first, with preview + unread |
| `POST` | `/chat/conversations` | `chat:create` | Start (or reuse) a DM: `{ userId }` |
| `POST` | `/chat/channels` | `chat:create` | Create a channel (**feature-flagged**, see below) |
| `GET` | `/chat/conversations/:id/messages` | `chat:read` | History, newest first; cursor via `?before=<iso>&limit=` |
| `POST` | `/chat/conversations/:id/messages` | `chat:create` | Send text: `{ body }` |
| `POST` | `/chat/conversations/:id/read` | `chat:update` | Advance your read marker |
| `PATCH` | `/chat/messages/:id` | `chat:update` | Edit your own message: `{ body }` |
| `DELETE` | `/chat/messages/:id` | `chat:delete` | Soft-delete your own message |
| `POST` | `/chat/messages/:id/action` | `chat:update` | Act on a system message: `{ action: 'accept' \| 'dismiss' }` |

## System messages

`ChatSystemService` lets other features drop messages into the sender↔recipient DM. Every method is **best-effort**: a chat failure is logged and swallowed so it never breaks the originating action, and the chat message is a *notification surface*, not the authority for access.

### File share → "Accept & view file"

`FileManagerService.share` calls `notifyFileShares` after creating shares. For each **direct-user** share (role/group shares are skipped — they have no single DM, and the file manager's own notification still covers them) it ensures the owner↔recipient DM and posts a `file_share` message with `metadata { fileId, shareId, fileName, canDownload }` and `action_state = 'pending'`. The recipient sees **Accept & view file**; accepting sets `action_state = 'accepted'` and opens the file. **Access was already granted by the `file_share` row** — accepting is acknowledgement, not authorization.

### Class invite → "View class"

`ClassService.addTeacher` calls `notifyClassInvite` the first time a teacher is added to a class. It posts a `class_invite` message with `metadata { classId, className }` into the inviter↔invitee DM. The recipient sees **View class**, which opens `/dashboard/classes/:classId`.

Both integrations depend on `ChatModule` being `@Global` so `ChatSystemService` injects without an import cycle (chat never imports file-manager or class).

## Feature flag: channels

Direct messages are always on. Multi-participant **channels** are built into the schema and service but gated behind `CHAT_CHANNELS_ENABLED` (default `false`). While off, `POST /chat/channels` and `ChatService.createChannel` throw `403`. Turn it on per environment when the channel UI ships.

## Known limitations / future work

- **Per-conversation preview & unread** in the conversation list are resolved with one query each in parallel (a user's conversation count is small). Swap for a windowed/aggregated query if a user accrues many channels.
- **`action_state` is per-message**, which is correct for DMs (one recipient). Channels would need per-member action state.
- The SSE cookie set by a token refresh on the `/chat/stream` request is not persisted (the response is hijacked); the next normal request refreshes it.
- No typing indicators or presence yet; both fit the existing bus (publish ephemeral events to participant channels).
