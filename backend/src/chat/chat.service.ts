import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { isoDate } from '@/common/db-values';
import { ChatRealtimeService } from './chat-realtime.service';
import { MessageCipher } from './message-cipher.service';
import { ChatEventType, channelsEnabled } from './chat.constants';
import type {
  ChatConversation,
  ChatMessage,
  ChatParticipant,
} from './chat.types';

const MESSAGE_SELECT = {
  id: true,
  conversation_id: true,
  sender_id: true,
  type: true,
  body: true,
  metadata: true,
  action_state: true,
  created_at: true,
  edited_at: true,
  deleted_at: true,
} as const;
const CONVERSATION_SELECT = {
  id: true,
  school_id: true,
  type: true,
  title: true,
  direct_key: true,
  created_by: true,
  created_at: true,
  last_message_at: true,
} as const;
const PROFILE_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  avatar_url: true,
} as const;

/** Ids arrive unvalidated; a malformed one simply matches nothing. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID.test(v);

interface ConversationRow {
  id: string;
  school_id: string;
  type: 'direct' | 'channel';
  title: string | null;
  direct_key: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
}

const toConversationRow = (r: {
  id: string;
  school_id: string;
  type: ConversationRow['type'];
  title: string | null;
  direct_key: string | null;
  created_by: string | null;
  created_at: Date | null;
  last_message_at: Date | null;
}): ConversationRow => ({
  ...r,
  created_at: isoDate(r.created_at)!,
  last_message_at: isoDate(r.last_message_at)!,
});

const toMessageRow = (r: {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageRow['type'];
  body: string | null;
  metadata: Prisma.JsonValue;
  action_state: MessageRow['action_state'];
  created_at: Date | null;
  edited_at: Date | null;
  deleted_at: Date | null;
}): MessageRow => ({
  ...r,
  metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  created_at: isoDate(r.created_at)!,
  edited_at: isoDate(r.edited_at),
  deleted_at: isoDate(r.deleted_at),
});

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: ChatMessage['type'];
  body: string | null;
  metadata: Record<string, unknown> | null;
  action_state: ChatMessage['actionState'];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

/**
 * Direct messaging between users of the same school, plus a feature-flagged
 * base for channels. Postgres is the source of truth; every write also fans a
 * realtime event out over the Redis bus (see ChatRealtimeService).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ChatRealtimeService,
    private readonly cipher: MessageCipher,
  ) {}

  /** The caller's school; a user without one is a server error, as before. */
  private async schoolOf(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }
    return schoolId;
  }

  // ── Users you can message ──────────────────────────────────────────────────

  /** Active users in the caller's school, excluding the caller. */
  async listMessageableUsers(userId: string): Promise<ChatParticipant[]> {
    const schoolId = await this.schoolOf(userId);
    const data = await this.prisma.user_profile.findMany({
      where: { school_id: schoolId, is_active: true, id: { not: userId } },
      orderBy: { first_name: 'asc' },
      select: PROFILE_SELECT,
    });

    return data.map((p) => ({
      userId: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      avatarUrl: p.avatar_url,
    }));
  }

  // ── Conversations ──────────────────────────────────────────────────────────

  /** The caller's conversations, most-recent first, with previews + unread. */
  async listConversations(userId: string): Promise<ChatConversation[]> {
    const membershipRows = await this.membershipsOf(userId);
    const ids = membershipRows.map((m) => m.conversation_id);

    if (ids.length === 0) return [];

    const rows = (
      await this.prisma.conversation.findMany({
        where: { id: { in: ids } },
        orderBy: { last_message_at: { sort: 'desc', nulls: 'first' } },
        select: CONVERSATION_SELECT,
      })
    ).map(toConversationRow);

    // Unread counts for the whole set resolve in one round-trip (RPC) rather
    // than one COUNT query per conversation. Participants likewise batch.
    const [participantsByConversation, unreadByConversation] =
      await Promise.all([
        this.participantsFor(ids),
        this.unreadCountsFor(userId, membershipRows),
      ]);

    // Message previews are still fetched per-conversation (in parallel); a
    // windowed DISTINCT-ON RPC would collapse these too if it becomes hot.
    return Promise.all(
      rows.map(async (conv) => {
        const lastMessage = await this.lastMessageFor(conv.id);
        return this.presentConversation(
          conv,
          participantsByConversation.get(conv.id) ?? [],
          lastMessage,
          unreadByConversation.get(conv.id) ?? 0,
        );
      }),
    );
  }

  /** Start (or reuse) a direct conversation with another school member. */
  async getOrCreateDirect(
    userId: string,
    otherUserId: string,
  ): Promise<ChatConversation> {
    if (otherUserId === userId) {
      throw new BadRequestException('You cannot message yourself');
    }

    const schoolId = await this.schoolOf(userId);
    const otherSchoolId = await this.resolveSchool(otherUserId);
    if (otherSchoolId !== schoolId) {
      throw new ForbiddenException('That user is not in your school');
    }

    const directKey = ChatService.directKey(userId, otherUserId);

    const existing = await this.findDirect(schoolId, directKey);
    if (existing) return this.summarize(existing, userId);

    let created: ConversationRow;
    try {
      created = await this.insertConversation({
        school_id: schoolId,
        type: 'direct',
        direct_key: directKey,
        created_by: userId,
      });
    } catch (err) {
      // Lost a race to the unique (school_id, direct_key) index — reuse theirs.
      const raced = await this.findDirect(schoolId, directKey);
      if (raced) return this.summarize(raced, userId);
      this.logger.error(`Failed to create DM: ${(err as Error).message}`);
      throw new BadRequestException('Failed to start conversation');
    }

    try {
      await this.prisma.conversation_member.createMany({
        data: [
          { conversation_id: created.id, user_id: userId, role: 'owner' },
          { conversation_id: created.id, user_id: otherUserId, role: 'member' },
        ],
      });
    } catch (err) {
      this.logger.error(
        `Failed to add DM members: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to start conversation');
    }

    const summary = await this.summarize(created, userId);
    // Both sides should see the new conversation appear immediately.
    await this.realtime.publishToUsers([userId, otherUserId], {
      type: ChatEventType.Conversation,
      data: summary,
    });
    return summary;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  /** A page of a conversation's history, newest first. */
  async listMessages(
    userId: string,
    conversationId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<ChatMessage[]> {
    await this.assertMember(userId, conversationId);
    const limit = Math.min(opts.limit ?? 30, 100);

    const before = opts.before ? new Date(opts.before) : null;
    const data = await this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        ...(before ? { created_at: { lt: before } } : {}),
      },
      orderBy: { created_at: { sort: 'desc', nulls: 'first' } },
      take: limit,
      select: MESSAGE_SELECT,
    });
    return data.map((m) => this.presentMessage(toMessageRow(m)));
  }

  /** Send a text message to a conversation the caller belongs to. */
  async sendMessage(
    userId: string,
    conversationId: string,
    body: string,
  ): Promise<ChatMessage> {
    const conversation = await this.assertMember(userId, conversationId);
    return this.postMessage({
      conversation,
      senderId: userId,
      type: 'text',
      body,
    });
  }

  /** Edit the caller's own message. */
  async editMessage(
    userId: string,
    messageId: string,
    body: string,
  ): Promise<ChatMessage> {
    const message = await this.loadOwnMessage(userId, messageId);
    const data = await this.updateMessage(messageId, {
      body: this.cipher.encrypt(body),
      edited_at: new Date(),
    });
    if (!data) throw new BadRequestException('Failed to edit message');

    const present = this.presentMessage(data);
    await this.fanOutMessage(message.conversation_id, present);
    return present;
  }

  /** Soft-delete the caller's own message. */
  async deleteMessage(userId: string, messageId: string): Promise<ChatMessage> {
    const message = await this.loadOwnMessage(userId, messageId);
    const data = await this.updateMessage(messageId, {
      deleted_at: new Date(),
      body: null,
    });
    if (!data) {
      throw new BadRequestException('Failed to delete message');
    }

    const present = this.presentMessage(data);
    await this.fanOutMessage(message.conversation_id, present);
    return present;
  }

  /** Advance the caller's read marker to now. */
  async markRead(
    userId: string,
    conversationId: string,
  ): Promise<{ ok: true; lastReadAt: string }> {
    await this.assertMember(userId, conversationId);
    const now = new Date();
    const lastReadAt = now.toISOString();
    await this.prisma.conversation_member
      .updateMany({
        where: { conversation_id: conversationId, user_id: userId },
        data: { last_read_at: now },
      })
      .catch((err: Error) =>
        this.logger.error(`Failed to mark read: ${err.message}`),
      );

    // Let the user's own other tabs/devices clear their unread badge too.
    await this.realtime.publishToUsers([userId], {
      type: ChatEventType.Read,
      data: { conversationId, userId, lastReadAt },
    });
    return { ok: true, lastReadAt };
  }

  /** Total unread messages across all of the caller's conversations. */
  async totalUnread(userId: string): Promise<{ count: number }> {
    const rows = await this.membershipsOf(userId);
    if (rows.length === 0) return { count: 0 };

    const counts = await this.unreadCountsFor(userId, rows);
    let total = 0;
    for (const n of counts.values()) total += n;
    return { count: total };
  }

  async postMessage(input: {
    conversation: ConversationRow;
    senderId: string;
    type: ChatMessage['type'];
    body: string | null;
    metadata?: Record<string, unknown>;
    actionState?: ChatMessage['actionState'];
  }): Promise<ChatMessage> {
    const { conversation, senderId } = input;
    const now = new Date();

    let data: MessageRow;
    try {
      data = toMessageRow(
        await this.prisma.message.create({
          data: {
            conversation_id: conversation.id,
            school_id: conversation.school_id,
            sender_id: senderId,
            type: input.type,
            // Encrypted at rest; presentMessage decrypts on the way out.
            body: this.cipher.encrypt(input.body),
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            action_state: input.actionState ?? null,
          },
          select: MESSAGE_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to insert message: ${(err as Error).message}`);
      throw new BadRequestException('Failed to send message');
    }

    // Bookkeeping only: as before, a failure here does not fail the send.
    await this.prisma.conversation
      .updateMany({
        where: { id: conversation.id },
        data: { last_message_at: now },
      })
      .catch((err: Error) =>
        this.logger.error(`Failed to bump conversation: ${err.message}`),
      );

    // The sender has, by definition, seen their own message.
    await this.prisma.conversation_member
      .updateMany({
        where: { conversation_id: conversation.id, user_id: senderId },
        data: { last_read_at: now },
      })
      .catch((err: Error) =>
        this.logger.error(`Failed to mark sender read: ${err.message}`),
      );

    const present = this.presentMessage(data);
    await this.fanOutMessage(conversation.id, present);
    return present;
  }

  /** Load a conversation row (for system-message posting), or throw. */
  async loadConversation(conversationId: string): Promise<ConversationRow> {
    const data = isUuid(conversationId)
      ? await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: CONVERSATION_SELECT,
        })
      : null;
    if (!data) throw new NotFoundException('Conversation not found');
    return toConversationRow(data);
  }

  /**
   * Ensure a direct conversation exists between two users and return its row.
   * Used by system messages (file share) that must land in the
   * sender↔recipient DM. Does not emit a Conversation event on its own — the
   * subsequent message emission already surfaces the conversation.
   */
  async ensureDirectConversationRow(
    schoolId: string,
    userA: string,
    userB: string,
  ): Promise<ConversationRow> {
    const directKey = ChatService.directKey(userA, userB);
    const existing = await this.findDirect(schoolId, directKey);
    if (existing) return existing;

    let created: ConversationRow;
    try {
      created = await this.insertConversation({
        school_id: schoolId,
        type: 'direct',
        direct_key: directKey,
        created_by: userA,
      });
    } catch {
      const raced = await this.findDirect(schoolId, directKey);
      if (raced) return raced;
      throw new BadRequestException('Failed to open conversation');
    }

    await this.prisma.conversation_member
      .createMany({
        data: [
          { conversation_id: created.id, user_id: userA, role: 'owner' },
          { conversation_id: created.id, user_id: userB, role: 'member' },
        ],
      })
      .catch((err: Error) =>
        this.logger.error(`Failed to add DM members: ${err.message}`),
      );

    return created;
  }

  /** Set a system message's action state and fan the change out. */
  async setActionState(
    userId: string,
    messageId: string,
    state: 'accepted' | 'dismissed',
  ): Promise<ChatMessage> {
    const message = isUuid(messageId)
      ? await this.prisma.message.findUnique({
          where: { id: messageId },
          select: {
            id: true,
            conversation_id: true,
            sender_id: true,
            action_state: true,
          },
        })
      : null;

    if (!message) throw new NotFoundException('Message not found');

    const conversation = await this.assertMember(
      userId,
      message.conversation_id,
    );
    // The recipient acts on it, never the sender who created the action.
    if (message.sender_id === userId) {
      throw new ForbiddenException('You cannot act on your own request');
    }
    if (message.action_state === null) {
      throw new BadRequestException('This message has no action');
    }

    const data = await this.updateMessage(messageId, { action_state: state });
    if (!data) {
      throw new BadRequestException('Failed to update action');
    }

    const present = this.presentMessage(data);
    await this.realtime.publishToUsers(await this.memberIds(conversation.id), {
      type: ChatEventType.MessageAction,
      data: present,
    });
    return present;
  }

  // ── Channels (feature-flagged) ──────────────────────────────────────────────

  async createChannel(
    userId: string,
    title: string,
    memberIds: string[],
  ): Promise<ChatConversation> {
    if (!channelsEnabled()) {
      throw new ForbiddenException('Channels are not enabled');
    }
    const schoolId = await this.schoolOf(userId);

    // Same rule as direct messages: members come from the creator's school.
    const invited = [...new Set(memberIds)].filter((id) => id !== userId);
    if (invited.length > 0) {
      const sameSchool = invited.every(isUuid)
        ? await this.prisma.user_profile.findMany({
            where: { id: { in: invited }, school_id: schoolId },
            select: { id: true },
          })
        : [];
      if (sameSchool.length !== invited.length) {
        throw new ForbiddenException('Channel members must be in your school');
      }
    }

    let created: ConversationRow;
    try {
      created = await this.insertConversation({
        school_id: schoolId,
        type: 'channel',
        title,
        created_by: userId,
      });
    } catch {
      throw new BadRequestException('Failed to create channel');
    }

    const uniqueMembers = [...new Set([userId, ...memberIds])];
    await this.prisma.conversation_member
      .createMany({
        data: uniqueMembers.map((id) => ({
          conversation_id: created.id,
          user_id: id,
          role: id === userId ? 'owner' : 'member',
        })),
      })
      .catch((err: Error) =>
        this.logger.error(`Failed to add channel members: ${err.message}`),
      );

    const summary = await this.summarize(created, userId);
    await this.realtime.publishToUsers(uniqueMembers, {
      type: ChatEventType.Conversation,
      data: summary,
    });
    return summary;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async fanOutMessage(
    conversationId: string,
    message: ChatMessage,
  ): Promise<void> {
    const members = await this.memberIds(conversationId);
    await this.realtime.publishToUsers(members, {
      type: ChatEventType.Message,
      data: message,
    });
  }

  private async assertMember(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRow> {
    const membership = isUuid(conversationId)
      ? await this.prisma.conversation_member.findUnique({
          where: {
            conversation_id_user_id: {
              conversation_id: conversationId,
              user_id: userId,
            },
          },
          select: { id: true },
        })
      : null;

    if (!membership) {
      throw new ForbiddenException('You are not in this conversation');
    }
    return this.loadConversation(conversationId);
  }

  private async loadOwnMessage(
    userId: string,
    messageId: string,
  ): Promise<MessageRow> {
    const data = isUuid(messageId)
      ? await this.prisma.message.findUnique({
          where: { id: messageId },
          select: MESSAGE_SELECT,
        })
      : null;
    if (!data) throw new NotFoundException('Message not found');
    if (data.sender_id !== userId) {
      throw new ForbiddenException('You can only modify your own messages');
    }
    return toMessageRow(data);
  }

  /** Update one message and return it, or null when that failed. */
  private async updateMessage(
    messageId: string,
    data: Prisma.messageUpdateInput,
  ): Promise<MessageRow | null> {
    try {
      return toMessageRow(
        await this.prisma.message.update({
          where: { id: messageId },
          data,
          select: MESSAGE_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to update message: ${(err as Error).message}`);
      return null;
    }
  }

  private async insertConversation(
    data: Prisma.conversationUncheckedCreateInput,
  ): Promise<ConversationRow> {
    return toConversationRow(
      await this.prisma.conversation.create({
        data,
        select: CONVERSATION_SELECT,
      }),
    );
  }

  private async membershipsOf(
    userId: string,
  ): Promise<{ conversation_id: string; last_read_at: string | null }[]> {
    const rows = await this.prisma.conversation_member.findMany({
      where: { user_id: userId },
      select: { conversation_id: true, last_read_at: true },
    });
    return rows.map((m) => ({
      conversation_id: m.conversation_id,
      last_read_at: isoDate(m.last_read_at),
    }));
  }

  private async memberIds(conversationId: string): Promise<string[]> {
    const data = await this.prisma.conversation_member.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true },
    });
    return data.map((m) => m.user_id);
  }

  private async findDirect(
    schoolId: string,
    directKey: string,
  ): Promise<ConversationRow | null> {
    const data = await this.prisma.conversation.findFirst({
      where: { school_id: schoolId, type: 'direct', direct_key: directKey },
      select: CONVERSATION_SELECT,
    });
    return data ? toConversationRow(data) : null;
  }

  private async lastMessageFor(
    conversationId: string,
  ): Promise<ChatMessage | null> {
    const data = await this.prisma.message.findFirst({
      where: { conversation_id: conversationId },
      orderBy: { created_at: { sort: 'desc', nulls: 'first' } },
      select: MESSAGE_SELECT,
    });
    return data ? this.presentMessage(toMessageRow(data)) : null;
  }

  private async unreadCountsFor(
    userId: string,
    memberships: { conversation_id: string; last_read_at: string | null }[],
  ): Promise<Map<string, number>> {
    try {
      const data = await this.prisma.$queryRaw<
        { conversation_id: string; unread: bigint | number }[]
      >`SELECT conversation_id, unread FROM chat.unread_counts(${userId}::uuid)`;
      const map = new Map<string, number>();
      for (const row of data) {
        map.set(row.conversation_id, Number(row.unread) || 0);
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `unread_counts RPC unavailable, falling back to per-conversation counts: ${String(err)}`,
      );
      const entries = await Promise.all(
        memberships.map(
          async (m) =>
            [
              m.conversation_id,
              await this.unreadFor(m.conversation_id, userId, m.last_read_at),
            ] as const,
        ),
      );
      return new Map(entries);
    }
  }

  private async unreadFor(
    conversationId: string,
    userId: string,
    lastReadAt: string | null,
  ): Promise<number> {
    return this.prisma.message
      .count({
        where: {
          conversation_id: conversationId,
          sender_id: { not: userId },
          deleted_at: null,
          ...(lastReadAt ? { created_at: { gt: new Date(lastReadAt) } } : {}),
        },
      })
      .catch(() => 0);
  }

  /** Members (with profiles) for a set of conversations, grouped by id. */
  private async participantsFor(
    conversationIds: string[],
  ): Promise<Map<string, ChatParticipant[]>> {
    const rows = await this.prisma.conversation_member.findMany({
      where: { conversation_id: { in: conversationIds } },
      select: { conversation_id: true, user_id: true },
    });
    const userIds = [...new Set(rows.map((m) => m.user_id))];

    const profiles = await this.prisma.user_profile.findMany({
      where: { id: { in: userIds } },
      select: PROFILE_SELECT,
    });

    const profileMap = new Map(
      profiles.map((p) => [
        p.id,
        {
          userId: p.id,
          firstName: p.first_name,
          lastName: p.last_name,
          avatarUrl: p.avatar_url,
        },
      ]),
    );

    const grouped = new Map<string, ChatParticipant[]>();
    for (const m of rows) {
      const participant = profileMap.get(m.user_id);
      if (!participant) continue;
      const list = grouped.get(m.conversation_id) ?? [];
      list.push(participant);
      grouped.set(m.conversation_id, list);
    }
    return grouped;
  }

  /** Build a full conversation summary for one conversation and one viewer. */
  private async summarize(
    conv: ConversationRow,
    userId: string,
  ): Promise<ChatConversation> {
    const [participantsMap, lastMessage] = await Promise.all([
      this.participantsFor([conv.id]),
      this.lastMessageFor(conv.id),
    ]);
    const membership = await this.prisma.conversation_member.findUnique({
      where: {
        conversation_id_user_id: { conversation_id: conv.id, user_id: userId },
      },
      select: { last_read_at: true },
    });

    const last_read_at: string | null = isoDate(membership?.last_read_at);

    const unreadCount = await this.unreadFor(conv.id, userId, last_read_at);

    return this.presentConversation(
      conv,
      participantsMap.get(conv.id) ?? [],
      lastMessage,
      unreadCount,
    );
  }

  private async resolveSchool(userId: string): Promise<string | null> {
    if (!isUuid(userId)) return null;
    return userSchoolId(this.prisma, userId);
  }

  private presentConversation(
    conv: ConversationRow,
    participants: ChatParticipant[],
    lastMessage: ChatMessage | null,
    unreadCount: number,
  ): ChatConversation {
    return {
      id: conv.id,
      type: conv.type,
      title: conv.title,
      lastMessageAt: conv.last_message_at,
      participants,
      lastMessage,
      unreadCount,
    };
  }

  private presentMessage(m: MessageRow): ChatMessage {
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      type: m.type,
      body: this.cipher.decrypt(m.body),
      metadata: m.metadata ?? {},
      actionState: m.action_state,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
    };
  }

  /** Canonical unordered key for a direct conversation between two users. */
  static directKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }
}
