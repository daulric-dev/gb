---
sidebar_label: Messages (Chat)
---

# Messages Page

**Route**: `/dashboard/chat`
**Files**: `app/dashboard/chat/`, `lib/chat.ts`, `providers/ChatProvider.tsx`

Real-time direct messaging with anyone at your school. Receives over Server-Sent Events, sends over REST; system messages (a shared file, a class invite) render inline with an action button. See the [backend Chat module](../backend/chat.md) for the transport and data model.

## State & transport — `lib/chat.ts`

Follows the module-level-signal pattern of `lib/file-notifications.ts` (no query cache; signals are the store):

| Signal | Meaning |
|--------|---------|
| `conversations` | Conversation summaries, newest first |
| `messagesByConversation` | `Record<conversationId, ChatMessage[]>`, oldest-first per thread |
| `activeConversationId` | Currently open thread |
| `unreadChat` | Total unread across conversations → sidebar badge |
| `chatConnected` | Whether the SSE stream is up |

**SSE.** `connectChat(userId)` opens an `EventSource` to `${NEXT_PUBLIC_API_URL}/api/chat/stream` with `withCredentials: true` (the session cookie authenticates it — `EventSource` cannot send custom headers, and the stream doesn't need `X-API-Version`). Handlers for the `message` / `conversation` / `read` / `message_action` events reduce into the signals. The browser auto-reconnects SSE; after repeated failures (e.g. a Worker-only deployment) the client **falls back to 15s polling** so the UI still updates.

Reducers keep the store consistent: incoming messages are deduped by id (so an optimistic send + its SSE echo don't double), the conversation is bumped to the top, and unread is only incremented when the message isn't mine and the thread isn't open and focused (in which case it's auto-marked read).

## Connection lifecycle — `ChatProvider`

`providers/ChatProvider.tsx` is mounted once in `app/dashboard/layout.tsx`. It calls `connectChat(profile.id)` on mount and `disconnectChat()` on unmount, so the **Messages** unread badge and any open thread stay live across the whole dashboard, not just the chat page.

## UI

| Component | Purpose |
|-----------|---------|
| `page.tsx` | Two-pane layout (list + thread); responsive — one pane at a time on mobile with a back button |
| `_components/ConversationList.tsx` | Avatar, name, last-message preview, per-conversation unread pill, time |
| `_components/MessageThread.tsx` | Message bubbles, the composer (Enter to send, Shift+Enter for newline), and system-message cards |
| `_components/NewChatDialog.tsx` | Searchable people picker (`GET /chat/users`) → `openDirectConversation` |

**System-message cards** (`MessageThread` → `SystemCard`): the recipient sees the action button, the sender sees a status line.

- **File share** — *Accept & view file* → marks the action accepted, then opens `/api/files/:id/content` in a new tab (the session cookie authorizes it).
- **Class invite** — *View class* → marks accepted, then routes to `/dashboard/classes/:classId`.
- Either can be **Dismissed** while `pending`.

## Sidebar

`components/layout/app-sidebar.tsx` adds a **Messages** item (`MessagesSquare` icon) with an unread pill bound to `unreadChat`, mirroring the Files/Announcements badges. The count stays live via SSE and is also refreshed on navigation.

## Notes

- Auth is cookie-only (`credentials: "include"`), same as the rest of the app; no token is stored in JS.
- The frontend origin differs from the API origin (`NEXT_PUBLIC_API_URL`). The page's Content-Security-Policy `connect-src` must allow the API origin for `EventSource` to connect.
