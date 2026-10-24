# Chat (`src/chat`)

The chat module is in-app messaging between users of the same school. It supports direct messages (one-to-one conversations, always on) and multi-participant channels (behind the `CHAT_CHANNELS_ENABLED` flag), message edit and soft delete, read markers and unread counts, online presence, and "system" messages that other features drop into a DM, such as "shared a file with you" with an inline Accept / Dismiss action. Postgres is the source of truth. Every write also publishes a realtime event to each participant's channel on the Redis pub/sub bus, and each browser holds one server-sent-events (SSE) stream subscribed to its own user's channel, so delivery works across replicas without sticky sessions. Message bodies are encrypted at rest with AES-256-GCM.

## What it provides

### HTTP routes

All routes use `AuthGuard` and `PermissionGuard`. The permission keys are on the `chat` resource; membership of the conversation and ownership of a message are checked per row in `ChatService`.

| Method | Path | Permission | What it does |
|--------|------|------------|--------------|
| GET | `/api/chat/stream` | `chat:read` | Long-lived SSE stream. Subscribes to the caller's user channel and, if they have a school, to the school's presence events, marks them online, sends a `: ping` heartbeat every 25 s and cleans up on disconnect. Writes its own CORS headers via `corsOriginFor`. Events: `message`, `conversation`, `read`, `message_action`, `presence`. |
| GET | `/api/chat/presence` | `chat:read` | `{ online: string[] }`, user ids online in the caller's school. |
| GET | `/api/chat/users` | `chat:read` | Active users in the caller's school, excluding the caller (the "new chat" directory). |
| GET | `/api/chat/unread-count` | `chat:read` | `{ count }`, total unread across all conversations. |
| GET | `/api/chat/conversations` | `chat:read` | The caller's conversations, most recent first, with participants, last message preview and unread count. |
| POST | `/api/chat/conversations` | `chat:create` | Start or reuse a DM with `userId` (must be in the same school; cannot be yourself). Body: `CreateConversationDto`. |
| POST | `/api/chat/channels` | `chat:create` | Create a channel with a title and members from the caller's school. `403` unless `CHAT_CHANNELS_ENABLED=true`. Body: `CreateChannelDto`. |
| GET | `/api/chat/conversations/:id/messages?before&limit` | `chat:read` | A page of history, newest first (default 30, max 100). Members only. |
| POST | `/api/chat/conversations/:id/messages` | `chat:create` | Send a text message. Body: `SendMessageDto`. |
| POST | `/api/chat/conversations/:id/read` | `chat:update` | Move the caller's read marker to now; publishes a `read` event to the caller's other tabs/devices. |
| PATCH | `/api/chat/messages/:id` | `chat:update` | Edit the caller's own message. Body: `SendMessageDto`. |
| DELETE | `/api/chat/messages/:id` | `chat:delete` | Soft-delete the caller's own message (body cleared, `deleted_at` set). |
| POST | `/api/chat/messages/:id/action` | `chat:update` | Accept or dismiss a system message's inline action. Only a recipient may act, never the sender. Body: `MessageActionDto`. |

### Services / exports

`ChatModule` is `@Global()` and exports `ChatService` and `ChatSystemService`.

- `ChatService` - all conversation and message logic: `listMessageableUsers`, `listConversations`, `getOrCreateDirect`, `createChannel`, `listMessages`, `sendMessage`, `editMessage`, `deleteMessage`, `markRead`, `totalUnread`, `setActionState`. For system messages it also exposes `postMessage(...)` (insert, bump the conversation, mark the sender read, fan out), `loadConversation(id)` and `ensureDirectConversationRow(schoolId, a, b)`. `ChatService.directKey(a, b)` is the canonical, order-independent key that makes a DM unique per school.
- `ChatSystemService.notifyFileShares(ownerId, file, shares)` - for each direct (user) file share, posts a `file_share` message with a pending action into the owner-to-recipient DM. Role and course shares are skipped. It is best effort: failures are logged and never break the file share.

Internal providers (not exported):

- `ChatRealtimeService` - chat's view of `RedisPubSubService`: `publishToUsers(userIds, event)` (deduplicated) and `subscribeUser(userId, handler)`.
- `MessageCipher` - `encrypt` / `decrypt` for message bodies. Envelope format `enc:v<version>:<iv>:<tag>:<ciphertext>` (base64 parts). Bodies without the `enc:` prefix are legacy plaintext and pass through. A missing key, malformed envelope or failed authentication returns an empty body rather than raw ciphertext. In production the constructor throws if no key is configured.

### Other

- `chat.constants.ts`: `userChannel(userId)` (`chat:u:<userId>`), `channelsEnabled()`, and the `ChatEventType` event names.
- `chat.types.ts`: `ChatMessage`, `ChatParticipant`, `ChatConversation` and `ChatEvent` wire types. Message `type` is `text`, `file_share`, `system` or the legacy `class_invite` (no longer sent, kept so old messages load).
- Unread counts come from the SQL function `chat.unread_counts(uuid)` (defined in `prisma/migrations/0_baseline/migration.sql`); if the call fails the service falls back to one count query per conversation.

## Used by

- `src/app.module.ts` imports `ChatModule`.
- `src/file-manager/file-manager.service.ts` injects `ChatSystemService` and calls `notifyFileShares` after creating shares.
- `src/permission/permission.catalog.ts` defines the `chat` permission resource and grants it to the default roles.
- Web: `frontend/lib/chat.ts` (all REST calls plus the `EventSource` on `/api/chat/stream`), used by `frontend/app/dashboard/chat/page.tsx`, its `_components/` (`NewChatDialog`, `ConversationList`, `MessageThread`) and the unread badge in `frontend/components/layout/app-sidebar.tsx`.
- Mobile: `mobile/app/chat/index.tsx` and `mobile/app/chat/[conversationId].tsx` (conversations, messages, read, presence, actions) and `mobile/src/features/chat/NewChatSheet.tsx` (`/chat/users`, `POST /chat/conversations`).

## Depends on

- `PrismaService` (global).
- `RedisPubSubService` and `PresenceService` from the global `RealtimeModule` (`src/realtime/`). Without Redis the bus runs in-process, which is correct only for a single instance.
- `PermissionGuard` / `@RequirePermission` from `src/permission/`, `AuthGuard` from `src/auth/`.
- `userSchoolId` and `isoDate` from `src/common/`, `corsOriginFor` from `src/config/origins.ts`.

## Data

`prisma/schema/chat.prisma`:

- `chat.conversation` - read/write (DM uniqueness via `school_id` + `direct_key`).
- `chat.conversation_member` - read/write (roles `owner`/`member`, `last_read_at`).
- `chat.message` - read/write (encrypted `body`, `metadata`, `action_state`, `edited_at`, `deleted_at`).

Also reads `public.user_profile` (`prisma/schema/school.prisma`) for the directory, participants and same-school checks.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `CHAT_ENCRYPTION_KEY` | (none) | Base64 of 32 bytes; registered as key version 1. Required in production; without it in development, bodies are stored as plaintext and a warning is logged. |
| `CHAT_ENCRYPTION_KEYS` | (none) | Rotation ring `1:<b64>,2:<b64>`; overrides `CHAT_ENCRYPTION_KEY`. The version must be a plain number: entries whose version does not parse as a number are skipped. |
| `CHAT_ENCRYPTION_KEY_VERSION` | highest version in the ring | Numeric version used to encrypt new messages. |
| `CHAT_CHANNELS_ENABLED` | `false` | `true` enables `POST /chat/channels`. |
| `NODE_ENV` | | `production` makes a missing key a startup error. |

Key ring format: `CHAT_ENCRYPTION_KEYS=1:<base64 key>,2:<base64 key>` and `CHAT_ENCRYPTION_KEY_VERSION=2` - versions are plain numbers (`MessageCipher` parses them with `Number(...)`).

## Files

| File | Purpose |
|------|---------|
| `chat.module.ts` | Global module; registers the controller and the four providers, exports `ChatService` and `ChatSystemService`. |
| `chat.controller.ts` | All `/chat` routes including the SSE stream. |
| `chat.service.ts` | Conversations, messages, read markers, unread counts, actions, channels. |
| `chat-system.service.ts` | `ChatSystemService`, system messages from other features (file shares). |
| `chat-realtime.service.ts` | Per-user publish/subscribe on the realtime bus. |
| `message-cipher.service.ts` | AES-256-GCM encryption at rest with a versioned keyring. |
| `chat.constants.ts` | Channel naming, channel feature flag, SSE event names. |
| `chat.types.ts` | Wire types for messages, participants, conversations and events. |
| `dto/` | Request DTOs, see [dto/README.md](dto/README.md). |
| `chat-realtime.service.test.ts` | Realtime fan-out over the in-process bus and `ChatService.directKey`. |
| `message-cipher.service.test.ts` | Encryption round-trip, random IVs, legacy plaintext, tamper detection, key rotation, disabled mode. |
| `chat.service.test.ts` | `ChatService` conversation, message, membership, unread and action logic. |
| `chat-system.service.test.ts` | `ChatSystemService.notifyFileShares`. |

## Tests

```bash
cd backend && bun test src/chat
```

Covered: event delivery only to targeted users with deduplicated fan-out, a stable sorted `directKey`, and the cipher (round-trip, distinct ciphertexts, legacy and null passthrough, tampered ciphertext yields no plaintext, an old key still decrypts after rotation, plaintext mode when no key is set). 

`chat.service.test.ts` builds `ChatService` with `createMockPrisma()`, a stub realtime service (`publishToUsers` recorded) and a visible fake `MessageCipher` (`encrypt` wraps as `enc(...)`, `decrypt` unwraps), and covers:

- `listMessageableUsers`: active users of the caller's school excluding the caller; no school is a plain (500) error.
- `getOrCreateDirect`: cannot message yourself (`400`); other school, unknown or malformed user id is `403` (malformed ids are not queried); an existing DM is reused without a create or event; a new DM gets owner + member rows and a `conversation` event to both users; a lost create race reuses the winner; create or member-insert failures are `400` with no event.
- `createChannel`: `403` with the flag off; members outside the school or malformed ids are `403` before any insert; members deduplicated, creator is owner, `conversation` event to all members; a create failure is `400`.
- Membership: non-members get `403` for list, send, read; malformed conversation ids are rejected without a query; a member of a vanished conversation gets `404`.
- `listMessages`: newest first, default 30, capped at 100, `before` becomes a `created_at < before` cursor, bodies decrypted, `null` metadata becomes `{}`.
- `sendMessage` / `postMessage`: the body is encrypted before it reaches the database and returned decrypted; the conversation is bumped and the sender marked read (failures there do not fail the send); a `message` event to every member; an insert failure is `400` with no event; metadata and action state pass through.
- `editMessage` / `deleteMessage`: own message only (`403` otherwise, `404` for missing or malformed ids); edit re-encrypts and stamps `edited_at`; delete is a soft delete (body cleared, `deleted_at` set, no row delete); both fan out; update failures are `400`. A `test.todo` records that a soft-deleted message can still be edited.
- `markRead`: marker update scoped to the caller, `read` event only to the caller, a write failure is logged not thrown.
- Unread counts: `totalUnread` sums the `chat.unread_counts` rows (bigint safe, user id bound as a value), skips the RPC with no memberships, falls back to per-conversation `count` queries (with and without `last_read_at`) when the RPC fails, and a failing count is 0.
- `listConversations`: order, participants (members without a profile dropped), last message preview and unread per conversation.
- `setActionState`: only a recipient may act (`403` for the sender and for non-members), `400` when the message has no action, `404` for missing or malformed ids, `message_action` event to members, update failure `400`.
- `loadConversation` and `ensureDirectConversationRow`: malformed ids `404` without a query, ISO timestamps, reuse, create without an event, race winner reuse or `400`, member insert failure swallowed.

`chat-system.service.test.ts` covers `notifyFileShares`: one pending `file_share` message per direct user share with the expected body and metadata, role/course shares and shares with the owner skipped, and one recipient's failure not stopping the others.

## See also

- [Chat backend doc](../../../docs/content/backend/chat.md)
- [Environment variables](../../../docs/content/environment-variables.md)
- [config README](../config/README.md), [common README](../common/README.md)
