/**
 * Section-local types for the Chat feature (mirrors the web `lib/chat.ts` DTOs).
 * Defined locally per the port brief — do not add these to the shared types.
 */

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

// ── Presentation helpers (ported from web `lib/chat.ts`) ──────────────────────

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

export function previewText(conv: ChatConversation): string {
  const m = conv.lastMessage;
  if (!m) return "No messages yet";
  if (m.deletedAt) return "Message deleted";
  if (m.type === "file_share") return "📎 Shared a file";
  if (m.type === "class_invite") return "🎓 Class invitation";
  return m.body ?? "";
}

/** Short time/date label for conversation rows. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Clock time for message bubbles. */
export function messageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** De-duplicate by id and sort oldest-first (the render order for a thread). */
export function dedupeMessages(list: ChatMessage[]): ChatMessage[] {
  const seen = new Map<string, ChatMessage>();
  for (const m of list) seen.set(m.id, m);
  return [...seen.values()].sort(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
  );
}
