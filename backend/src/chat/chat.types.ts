import type { ChatEventType } from './chat.constants';

/** A message as returned by the API and pushed over SSE. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'file_share' | 'class_invite' | 'system';
  body: string | null;
  metadata: Record<string, unknown>;
  actionState: 'pending' | 'accepted' | 'dismissed' | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** A member of a conversation (minimal profile for rendering). */
export interface ChatParticipant {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/** A conversation summary as returned by the list endpoint. */
export interface ChatConversation {
  id: string;
  type: 'direct' | 'channel';
  title: string | null;
  lastMessageAt: string;
  participants: ChatParticipant[];
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

/**
 * An event on the realtime bus. `data` is serialized to the SSE `data:` line
 * and `type` becomes the SSE `event:` name.
 */
export interface ChatEvent<T = unknown> {
  type: ChatEventType;
  data: T;
}
