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
| `chat-realtime.service.ts` | The Redis pub/sub bus + per-replica SSE subscription registry |
| `chat.constants.ts` | Channel naming, SSE event names, the channels feature flag |
| `chat.types.ts` | Shared response/event shapes |
| `dto/` | Request validation (create conversation, send message, message action, list query, create channel) |

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
4. Redis delivers that event to whichever replica currently holds each participant's SSE stream — no sticky sessions needed. `ChatRealtimeService` reference-counts local handlers so a channel is subscribed while ≥1 local stream wants it and unsubscribed when the last disconnects.

**Fallback.** When `USE_REDIS` is not `true`, the bus dispatches in-process only (correct for single-process dev). `ioredis` is used (not Bun's `RedisClient`) because a subscriber connection must be dedicated to pub/sub.

**SSE frames emitted:** `message`, `conversation`, `read`, `message_action` (see `ChatEventType`).

> The SSE endpoint requires the long-lived Node deployment (`infrastructure/docker-compose.yml`). It does **not** work on the Worker entrypoint (`worker.ts`), which replays requests through `fastify.inject()` and cannot stream. The frontend degrades to polling if the stream can't be established.

## REST API

All routes are under `/chat`, guarded by `AuthGuard` + `PermissionGuard` and require the `chat:*` catalog permissions (granted to `admin`, `teacher`, and `member` by default; ownership of a given message is enforced per-row in the service).

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/chat/stream` | `chat:read` | SSE event stream (see above) |
| `GET` | `/chat/users` | `chat:read` | Active users in your school you can message |
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
