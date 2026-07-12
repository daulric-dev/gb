// Chat client: a signal-based store, the REST calls, and the Server-Sent
// Events connection that keeps everything live. Mirrors the module-level-signal
// pattern used by lib/file-notifications.ts and lib/announcements.ts.

import { signal } from "@preact/signals-react";
import { api } from "@/lib/api";

// ── Types (mirror the backend chat DTOs) ─────────────────────────────────────

export type ChatMessageType = "text" | "file_share" | "class_invite" | "system";
export type ChatActionState = "pending" | "accepted" | "dismissed" | null;

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  body: string | null;
  metadata: Record<string, unknown>;
  actionState: ChatActionState;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatParticipant {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export interface ChatConversation {
  id: string;
  type: "direct" | "channel";
  title: string | null;
  lastMessageAt: string;
  participants: ChatParticipant[];
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const conversations = signal<ChatConversation[]>([]);
export const messagesByConversation = signal<Record<string, ChatMessage[]>>({});
export const activeConversationId = signal<string | null>(null);
export const unreadChat = signal(0);
export const chatConnected = signal(false);
/** User ids currently online in the caller's school. */
export const onlineUsers = signal<Set<string>>(new Set());

export function isOnline(userId: string | null | undefined): boolean {
  return !!userId && onlineUsers.value.has(userId);
}

/** Set once the SSE stream is up so we know whose messages are "mine". */
let currentUserId: string | null = null;

// ── REST ─────────────────────────────────────────────────────────────────────

export async function refreshConversations() {
  try {
    conversations.value = await api<ChatConversation[]>("/chat/conversations");
    recomputeUnread();
  } catch {
    // Non-fatal: keep whatever we had.
  }
}

export async function refreshChatUnread() {
  try {
    const { count } = await api<{ count: number }>("/chat/unread-count");
    unreadChat.value = count;
  } catch {
    // Non-fatal.
  }
}

export async function refreshPresence() {
  try {
    const { online } = await api<{ online: string[] }>("/chat/presence");
    onlineUsers.value = new Set(online);
  } catch {
    // Non-fatal: keep the last known set.
  }
}

export async function listMessageableUsers(): Promise<ChatParticipant[]> {
  try {
    return await api<ChatParticipant[]>("/chat/users");
  } catch {
    return [];
  }
}

/** Start (or reuse) a DM with a user, select it, and load its history. */
export async function openDirectConversation(
  userId: string,
): Promise<ChatConversation | null> {
  try {
    const conv = await api<ChatConversation>("/chat/conversations", {
      method: "POST",
      body: { userId },
    });
    upsertConversation(conv);
    await selectConversation(conv.id);
    return conv;
  } catch {
    return null;
  }
}

export async function selectConversation(conversationId: string) {
  activeConversationId.value = conversationId;
  await loadMessages(conversationId);
  await markConversationRead(conversationId);
}

export async function loadMessages(conversationId: string, before?: string) {
  const query = before
    ? `?before=${encodeURIComponent(before)}&limit=30`
    : "?limit=30";
  const page = await api<ChatMessage[]>(
    `/chat/conversations/${conversationId}/messages${query}`,
  );
  // The API returns newest-first; store oldest-first for rendering.
  const ordered = [...page].reverse();
  const existing = messagesByConversation.value[conversationId] ?? [];
  const merged = before ? [...ordered, ...existing] : ordered;
  messagesByConversation.value = {
    ...messagesByConversation.value,
    [conversationId]: dedupeMessages(merged),
  };
}

export async function sendChatMessage(conversationId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  const message = await api<ChatMessage>(
    `/chat/conversations/${conversationId}/messages`,
    { method: "POST", body: { body: trimmed } },
  );
  // Optimistically place it; the SSE echo is deduped by id.
  applyIncomingMessage(message);
}

export async function markConversationRead(conversationId: string) {
  // Clear locally first so the badge responds instantly.
  patchConversation(conversationId, { unreadCount: 0 });
  recomputeUnread();
  try {
    await api(`/chat/conversations/${conversationId}/read`, { method: "POST" });
  } catch {
    // Non-fatal: the next refresh reconciles.
  }
}

export async function actOnMessage(
  messageId: string,
  action: "accept" | "dismiss",
): Promise<ChatMessage | null> {
  try {
    const updated = await api<ChatMessage>(
      `/chat/messages/${messageId}/action`,
      { method: "POST", body: { action } },
    );
    applyMessageUpdate(updated);
    return updated;
  } catch {
    return null;
  }
}

// ── SSE stream ───────────────────────────────────────────────────────────────

let source: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let errorCount = 0;

const STREAM_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/stream`;

export function connectChat(userId: string) {
  currentUserId = userId;
  if (source || typeof window === "undefined") return;

  void refreshConversations();
  void refreshChatUnread();
  void refreshPresence();

  // Reconcile presence periodically so a user whose replica crashed (no clean
  // offline event) still drops off within a minute, even while SSE is healthy.
  presenceTimer = setInterval(() => void refreshPresence(), 45_000);

  try {
    source = new EventSource(STREAM_URL, { withCredentials: true });
  } catch {
    startPollingFallback();
    return;
  }

  source.onopen = () => {
    chatConnected.value = true;
    errorCount = 0;
    stopPollingFallback();
  };

  source.addEventListener("message", (e) =>
    applyIncomingMessage(parse<ChatMessage>(e.data)),
  );
  source.addEventListener("conversation", (e) =>
    upsertConversation(parse<ChatConversation>(e.data)),
  );
  source.addEventListener("message_action", (e) =>
    applyMessageUpdate(parse<ChatMessage>(e.data)),
  );
  source.addEventListener("read", (e) => {
    const data = parse<{ conversationId: string }>(e.data);
    if (!data) return;
    patchConversation(data.conversationId, { unreadCount: 0 });
    recomputeUnread();
  });
  source.addEventListener("presence", (e) => {
    const data = parse<{ userId: string; online: boolean }>(e.data);
    if (!data) return;
    const next = new Set(onlineUsers.value);
    if (data.online) next.add(data.userId);
    else next.delete(data.userId);
    onlineUsers.value = next;
  });

  source.onerror = () => {
    chatConnected.value = false;
    errorCount += 1;
    if (errorCount >= 3) startPollingFallback();
  };
}

export function disconnectChat() {
  source?.close();
  source = null;
  chatConnected.value = false;
  stopPollingFallback();
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  onlineUsers.value = new Set();
}

function startPollingFallback() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshConversations();
    void refreshChatUnread();
  }, 15_000);
}

function stopPollingFallback() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

function applyIncomingMessage(message: ChatMessage | null) {
  if (!message) return;
  const { conversationId } = message;

  const list = messagesByConversation.value[conversationId];
  // Only append to an already-loaded thread; unloaded threads fetch on open.
  if (list) {
    messagesByConversation.value = {
      ...messagesByConversation.value,
      [conversationId]: dedupeMessages([...list, message]),
    };
  }

  const isMine = message.senderId === currentUserId;
  const isActive = activeConversationId.value === conversationId;
  const isVisible =
    typeof document !== "undefined" && document.visibilityState === "visible";

  bumpConversation(message, isMine || (isActive && isVisible) ? 0 : 1);

  // Reading it immediately if the thread is open and focused.
  if (!isMine && isActive && isVisible) {
    void markConversationRead(conversationId);
  }
}

function applyMessageUpdate(message: ChatMessage | null) {
  if (!message) return;
  const list = messagesByConversation.value[message.conversationId];
  if (!list) return;
  messagesByConversation.value = {
    ...messagesByConversation.value,
    [message.conversationId]: list.map((m) =>
      m.id === message.id ? message : m,
    ),
  };
}

/** Move a conversation to the top and adjust its preview/unread. */
function bumpConversation(message: ChatMessage, unreadDelta: number) {
  const existing = conversations.value.find(
    (c) => c.id === message.conversationId,
  );
  if (!existing) {
    // A message for a conversation we don't have yet: pull the fresh list.
    void refreshConversations();
    if (unreadDelta > 0) unreadChat.value += unreadDelta;
    return;
  }
  const updated: ChatConversation = {
    ...existing,
    lastMessage: message,
    lastMessageAt: message.createdAt,
    unreadCount: existing.unreadCount + unreadDelta,
  };
  conversations.value = [
    updated,
    ...conversations.value.filter((c) => c.id !== message.conversationId),
  ];
  recomputeUnread();
}

function upsertConversation(conv: ChatConversation | null) {
  if (!conv) return;
  const rest = conversations.value.filter((c) => c.id !== conv.id);
  conversations.value = [conv, ...rest].sort(
    (a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt),
  );
  recomputeUnread();
}

function patchConversation(id: string, patch: Partial<ChatConversation>) {
  conversations.value = conversations.value.map((c) =>
    c.id === id ? { ...c, ...patch } : c,
  );
}

function recomputeUnread() {
  unreadChat.value = conversations.value.reduce(
    (sum, c) => sum + (c.unreadCount || 0),
    0,
  );
}

function dedupeMessages(list: ChatMessage[]): ChatMessage[] {
  const seen = new Map<string, ChatMessage>();
  for (const m of list) seen.set(m.id, m);
  return [...seen.values()].sort(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
  );
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Presentation helpers ─────────────────────────────────────────────────────

export function otherParticipant(
  conv: ChatConversation,
  selfId: string | null,
): ChatParticipant | null {
  if (conv.type === "channel") return null;
  return (
    conv.participants.find((p) => p.userId !== selfId) ??
    conv.participants[0] ??
    null
  );
}

export function conversationTitle(
  conv: ChatConversation,
  selfId: string | null,
): string {
  if (conv.title) return conv.title;
  const other = otherParticipant(conv, selfId);
  if (!other) return "Conversation";
  return (
    `${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() || "Unnamed user"
  );
}

export function participantName(p: ChatParticipant): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unnamed user";
}
