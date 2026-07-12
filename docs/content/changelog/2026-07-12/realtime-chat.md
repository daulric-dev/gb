---
sidebar_label: 2026-07-12 · Real-time chat
sidebar_position: 2
---

# 2026-07-12 - Real-time chat

A new **Messages** feature: real-time direct messaging between any two users in a school, delivered over Server-Sent Events and fanned out across the stateless backend replicas with Redis pub/sub. Sharing a file with a person and adding a teacher to a class now also arrive in chat as **system messages with an inline action**. **One new migration** (`chat` schema; no changes to existing tables) and **one new permission resource** (`chat`).

## What you can do

- **DM anyone in your school.** A new **Messages** item in the sidebar (with an unread badge) opens a two-pane chat. Pick a person, type, send — the other side sees it live.
- **Accept & view a shared file from chat.** When you share a file with a specific person, they get a `file_share` message in your DM with an **Accept & view file** button. (Role/group shares are unchanged — they still use the file-manager notification.)
- **View a class you were added to.** When a teacher is added to a class, they get a `class_invite` message with a **View class** button that opens the class.

## Transport: SSE + Redis pub/sub

The deployment has three stateless replicas behind nginx with no sticky sessions, cookie auth, and a Cloudflare Worker entrypoint that can't hold a streaming response. The chat bus is built for exactly that:

- The browser opens `GET /chat/stream` ([chat.controller.ts](../../../../backend/src/chat/chat.controller.ts)). Whichever replica it lands on subscribes to the user's Redis channel `chat:u:<id>` for the life of the connection and relays each event as an SSE frame, with a 25s heartbeat.
- A send `POST`s a message; `ChatService.postMessage` persists it and **publishes** one event per participant to their channels ([chat-realtime.service.ts](../../../../backend/src/chat/chat-realtime.service.ts)). Redis routes each event to the replica holding that participant's stream — no sticky sessions.
- `ioredis` (already used by BullMQ) drives a dedicated publisher + subscriber. With `USE_REDIS` off, the bus dispatches in-process (single-replica dev). Postgres is the source of truth, so Redis running `--appendonly no` is fine — it's a bus, not storage.

nginx gained a `location /api/chat/stream` block with `proxy_buffering off` and a long read timeout ([infrastructure/nginx/default.conf](../../../../infrastructure/nginx/default.conf)); the backend also sends `X-Accel-Buffering: no`. **SSE runs only on the long-lived Node deployment**, not the Worker path; the frontend falls back to 15s polling if the stream can't be established.

## Data model

New migration `supabase/migrations/20260712120000_chat.sql` adds a `chat` schema with `conversation`, `conversation_member`, and `message`. A DM is deduplicated by a canonical `direct_key` (`least(a):greatest(b)`) behind a unique partial index, so a conversation between two people exists at most once. Unread is a per-member `last_read_at` high-water mark. System messages are ordinary rows with a `type` and a `metadata` jsonb payload, plus a nullable `action_state` (`pending`/`accepted`/`dismissed`). RLS (member-scoped, school-scoped) is enabled as defense-in-depth; the API writes via the service role. Run `bun db:types` to pick up the new schema.

## Permissions

A `chat` resource was added to the permission catalog ([permission.catalog.ts](../../../../backend/src/permission/permission.catalog.ts)), granting read/create/update/delete to `admin`, `teacher`, and `member` by default — everyone can message. Ownership of a given message (edit/delete) and the right to act on a system message are enforced per-row in the service. The catalog sync grows from 60 to 64 entries.

## System-message integration

`ChatSystemService` ([chat-system.service.ts](../../../../backend/src/chat/chat-system.service.ts)) is best-effort by design: a chat failure is logged and swallowed so it never breaks the share or the teacher assignment, and **the chat message is a notification, not the source of access** — access is still granted by the `file_share` row / teacher assignment. `FileManagerService.share` and `ClassService.addTeacher` call it; `ChatModule` is `@Global` so it injects without an import cycle.

## Frontend

A signal-based store ([lib/chat.ts](../../../../frontend/lib/chat.ts)) mirrors the existing `file-notifications` pattern (no query cache): it owns the conversation list, per-thread messages, the unread badge, and the `EventSource`. Incoming messages are deduped by id (optimistic send + SSE echo don't double), the conversation bumps to the top, and unread only counts messages that aren't yours in a thread that isn't open and focused. `ChatProvider` mounts once in the dashboard layout so the badge and any open thread stay live everywhere. The page (`app/dashboard/chat/`) is a responsive two-pane list/thread with a searchable people picker; system messages render as action cards (recipient gets the button, sender sees a status).

## Channels are feature-flagged

Multi-participant **channels** are in the schema and service but gated behind `CHAT_CHANNELS_ENABLED` (default `false`) so they can be switched on per environment once their UI ships. Direct messages are always on.

## Tests

Added `chat-realtime.service.test.ts` — the in-process bus (subscribe / publish / unsubscribe / multi-user fan-out) and the `directKey` canonicalization. Existing `ClassService` and `FileManagerService` tests were updated for the new constructor dependency. Backend suite: 234 → 243 tests, all passing.

## Behavior notes / known limitations

- Conversation-list preview and unread are one query each in parallel (fine at DM scale); swap for an aggregated query if a user accrues many channels.
- `action_state` is per-message (correct for DMs); channels would need per-member action state.
- No typing indicators or presence yet — both fit the existing bus.
- The page's CSP `connect-src` must allow the API origin for `EventSource` (frontend and API are different origins via `NEXT_PUBLIC_API_URL`).
