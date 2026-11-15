import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { isoDate } from '@/common/db-values';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { OCCURRED_AT, plan } from '@/erasure/erasure-plan';
import { ChatRealtimeService } from './chat-realtime.service';
import { MessageCipher } from './message-cipher.service';
import { ChatEventType } from './chat.constants';
import { FeatureService } from '@/features/feature.service';
import { isOrgAdmin } from '@/organisation/org-admin';
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

/** Who is acting in chat: a student account or staff, and their school. */
interface ChatActor {
  id: string;
  schoolId: string | null;
  isStudent: boolean;
  /** The linked student record, for a student account. */
  studentId: string | null;
  /** That record's school, and whether it is still active. */
  studentSchoolId: string | null;
  studentActive: boolean;
}

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
 * Direct messaging between users of the same school, plus channels for staff
 * (the `chat_channels` feature). Students take part only with the
 * `student_messaging` feature: they message the staff who teach them, reply
 * to staff, and never message each other. Postgres is the source of truth; every write also fans a
 * realtime event out over the Redis bus (see ChatRealtimeService).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ChatRealtimeService,
    private readonly cipher: MessageCipher,
    private readonly erasure: ErasureLogService,
    private readonly features: FeatureService,
  ) {}

  /** The caller and their school; no school is a server error, as before. */
  private async callerOf(
    userId: string,
  ): Promise<ChatActor & { schoolId: string }> {
    const me = await this.actorOf(userId);
    if (!me.schoolId) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }
    return { ...me, schoolId: me.schoolId };
  }

  // ── Users you can message ──────────────────────────────────────────────────

  /**
   * Who the caller can start a conversation with, excluding the caller.
   * Staff: active staff of their school, plus (with `student_messaging`)
   * the students they teach. A student (only with `student_messaging`): the
   * staff who teach a course they are actively enrolled in.
   */
  async listMessageableUsers(userId: string): Promise<ChatParticipant[]> {
    const me = await this.callerOf(userId);
    const schoolId = me.schoolId;

    let where: Prisma.user_profileWhereInput;
    if (me.isStudent) {
      await this.features.assertEnabled(schoolId, 'student_messaging');
      const teachers = me.studentId
        ? await this.teachersOf(me.studentId, schoolId)
        : [];
      where = {
        id: { in: teachers.filter((id) => id !== userId) },
        school_id: schoolId,
        is_active: true,
        account_type: 'staff',
      };
    } else {
      const studentsOn = await this.features.isEnabled(
        schoolId,
        'student_messaging',
      );
      const taught = studentsOn
        ? await this.taughtStudentUserIds(userId, schoolId)
        : [];
      where = {
        school_id: schoolId,
        is_active: true,
        id: { not: userId },
        OR: [
          // Staff need a membership: an organisation admin managing this
          // school (active school, no membership) is not one of its staff.
          {
            account_type: 'staff',
            school_management: { some: { school_id: schoolId } },
          },
          ...(taught.length > 0 ? [{ id: { in: taught } }] : []),
        ],
      };
    }

    const data = await this.prisma.user_profile.findMany({
      where,
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
    // Only the active school's conversations: those of a school the caller
    // has switched away from cannot be opened (see assertMember).
    const me = await this.actorOf(userId);
    if (!me.schoolId) return [];
    const membershipRows = await this.membershipsOf(userId, me.schoolId);
    const ids = membershipRows.map((m) => m.conversation_id);

    if (ids.length === 0) return [];

    const rows = (
      await this.prisma.conversation.findMany({
        where: { id: { in: ids } },
        orderBy: { last_message_at: { sort: 'desc', nulls: 'first' } },
        select: CONVERSATION_SELECT,
      })
    ).map(toConversationRow);
    // Channels are for staff: a student never sees one.
    const visible = me.isStudent
      ? rows.filter((r) => r.type !== 'channel')
      : rows;
    if (visible.length === 0) return [];
    const visibleIds = visible.map((r) => r.id);

    // Unread counts, participants and previews each resolve in one
    // round-trip for the whole set rather than one query per conversation.
    const [participantsByConversation, unreadByConversation, lastByConversation] =
      await Promise.all([
        this.participantsFor(visibleIds),
        this.unreadCountsFor(userId, membershipRows),
        this.lastMessagesFor(visibleIds),
      ]);

    return visible.map((conv) =>
      this.presentConversation(
        conv,
        participantsByConversation.get(conv.id) ?? [],
        lastByConversation.get(conv.id) ?? null,
        unreadByConversation.get(conv.id) ?? 0,
      ),
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

    const me = await this.callerOf(userId);
    const schoolId = me.schoolId;
    const other = isUuid(otherUserId) ? await this.actorOf(otherUserId) : null;
    if (!other || other.schoolId !== schoolId) {
      throw new ForbiddenException('That user is not in your school');
    }

    const directKey = ChatService.directKey(userId, otherUserId);
    const existing = await this.findDirect(schoolId, directKey);
    await this.assertDirectAllowed(me, other, schoolId, !!existing);
    if (existing) {
      await this.repairDirectMembers(existing, [userId, otherUserId]);
      return this.summarize(existing, userId);
    }

    const opened = await this.createDirect(
      schoolId,
      directKey,
      userId,
      otherUserId,
    );
    if (!opened) throw new BadRequestException('Failed to start conversation');
    // Lost a race to the unique (school_id, direct_key) index: reuse theirs.
    if (!opened.created) return this.summarize(opened.row, userId);
    const created = opened.row;

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
    await this.assertCanPost(userId, conversation);
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
    // Editing a deleted message would put a body back on it.
    if (message.deleted_at) {
      throw new BadRequestException('A deleted message cannot be edited');
    }
    const data = await this.updateMessage(messageId, {
      body: this.cipher.encrypt(body),
      edited_at: new Date(),
    });
    if (!data) throw new BadRequestException('Failed to edit message');

    const present = this.presentMessage(data);
    await this.fanOutMessage(message.conversation_id, present);
    return present;
  }

  /**
   * Soft-delete the caller's own message (body cleared), logged as an
   * erasure in the same transaction. The tombstone row is removed by the
   * retention purge.
   */
  async deleteMessage(userId: string, messageId: string): Promise<ChatMessage> {
    const message = await this.loadOwnMessage(userId, messageId);
    let data: MessageRow | null = null;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const { school_id: schoolId, ...updated } = await tx.message.update({
          where: { id: messageId },
          data: { deleted_at: new Date(), body: null },
          select: { ...MESSAGE_SELECT, school_id: true },
        });
        await this.erasure.record(tx, {
          kind: 'chat_message',
          subjectTable: 'chat.message',
          subjectIds: [messageId],
          schoolId,
          actor: userId,
          reason: 'user_request',
          replay: plan.of(
            plan.update(
              'chat.message',
              { id: [messageId] },
              { body: null, deleted_at: OCCURRED_AT },
            ),
          ),
        });
        return toMessageRow(updated);
      });
    } catch (err) {
      this.logger.error(`Failed to delete message: ${(err as Error).message}`);
    }
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
    const { schoolId } = await this.actorOf(userId);
    if (!schoolId) return { count: 0 };
    const rows = await this.membershipsOf(userId, schoolId);
    if (rows.length === 0) return { count: 0 };

    // Only the active school's conversations count.
    const counts = await this.unreadCountsFor(userId, rows);
    let total = 0;
    for (const m of rows) total += counts.get(m.conversation_id) ?? 0;
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
    // Same rule as getOrCreateDirect: both ends must be in this school.
    const [schoolA, schoolB] = await Promise.all([
      this.resolveSchool(userA),
      this.resolveSchool(userB),
    ]);
    if (schoolA !== schoolId || schoolB !== schoolId) {
      throw new ForbiddenException('That user is not in your school');
    }

    const directKey = ChatService.directKey(userA, userB);
    const existing = await this.findDirect(schoolId, directKey);
    if (existing) {
      await this.repairDirectMembers(existing, [userA, userB]);
      return existing;
    }

    const opened = await this.createDirect(schoolId, directKey, userA, userB);
    if (!opened) throw new BadRequestException('Failed to open conversation');
    return opened.row;
  }

  /**
   * Create a DM with both members in one statement (a nested create commits
   * atomically), so a DM can never exist without its members. On a lost race
   * to the unique (school_id, direct_key) index the winner is reused, with any
   * missing member added back. Null when neither worked.
   */
  private async createDirect(
    schoolId: string,
    directKey: string,
    owner: string,
    member: string,
  ): Promise<{ row: ConversationRow; created: boolean } | null> {
    try {
      const row = toConversationRow(
        await this.prisma.conversation.create({
          data: {
            school_id: schoolId,
            type: 'direct',
            direct_key: directKey,
            created_by: owner,
            conversation_member: {
              create: [
                { user_id: owner, role: 'owner' },
                { user_id: member, role: 'member' },
              ],
            },
          },
          select: CONVERSATION_SELECT,
        }),
      );
      return { row, created: true };
    } catch (err) {
      const raced = await this.findDirect(schoolId, directKey);
      if (raced) {
        await this.repairDirectMembers(raced, [owner, member]);
        return { row: raced, created: false };
      }
      this.logger.error(`Failed to create DM: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Add back whichever of a DM's two members is missing (a DM created before
   * members were inserted atomically could have lost them). Best effort.
   */
  private async repairDirectMembers(
    conv: ConversationRow,
    userIds: string[],
  ): Promise<void> {
    try {
      const present = new Set(await this.memberIds(conv.id));
      const missing = userIds.filter((id) => !present.has(id));
      if (missing.length === 0) return;
      await this.prisma.conversation_member.createMany({
        data: missing.map((id) => ({
          conversation_id: conv.id,
          user_id: id,
          role: id === conv.created_by ? 'owner' : 'member',
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.error(
        `Failed to repair DM members: ${(err as Error).message}`,
      );
    }
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
            deleted_at: true,
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
    if (message.action_state === null || message.deleted_at) {
      throw new BadRequestException('This message has no action');
    }
    // A request is answered once; accepting after dismissing (or the reverse)
    // would let the outcome flip after the sender has acted on it.
    if (message.action_state !== 'pending') {
      throw new ConflictException('This request has already been answered');
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

  // ── Channels (the chat_channels feature) ──────────────────────────────────────────────

  async createChannel(
    userId: string,
    title: string,
    memberIds: string[],
  ): Promise<ChatConversation> {
    const me = await this.callerOf(userId);
    const schoolId = me.schoolId;
    if (me.isStudent) {
      throw new ForbiddenException('Channels are for staff');
    }
    await this.features.assertEnabled(schoolId, 'chat_channels');

    // Members are staff of the creator's school; students never join one.
    const invited = [...new Set(memberIds)].filter((id) => id !== userId);
    if (invited.length > 0) {
      const sameSchool = invited.every(isUuid)
        ? await this.prisma.user_profile.findMany({
            where: {
              id: { in: invited },
              school_id: schoolId,
              account_type: 'staff',
              school_management: { some: { school_id: schoolId } },
            },
            select: { id: true },
          })
        : [];
      if (sameSchool.length !== invited.length) {
        throw new ForbiddenException(
          'Channel members must be staff in your school',
        );
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
    const conversation = await this.loadConversation(conversationId);
    const me = await this.actorOf(userId);
    // A member row alone is not enough: the conversation must belong to the
    // caller's active school, and they must still belong to that school.
    if (!(await this.inSchool(me, conversation.school_id))) {
      throw new ForbiddenException('You are not in this conversation');
    }
    if (conversation.type === 'channel' && me.isStudent) {
      throw new ForbiddenException('Channels are for staff');
    }
    return conversation;
  }

  /**
   * Whether the user may still use chat in `schoolId`: it is their active
   * school, and they belong to it (an active student record there; for staff,
   * a membership, or being an organisation admin). The SSE stream re-checks
   * this on each heartbeat so a removed member stops receiving the school's
   * events.
   */
  async canUseSchool(userId: string, schoolId: string): Promise<boolean> {
    return this.inSchool(await this.actorOf(userId), schoolId);
  }

  /**
   * Whose presence the user may see: null for staff (the whole school), else
   * the staff a student can message (their teachers).
   */
  async presenceAudience(userId: string): Promise<Set<string> | null> {
    const me = await this.actorOf(userId);
    if (!me.isStudent) return null;
    if (!me.studentId || !me.schoolId) return new Set();
    return new Set(await this.teachersOf(me.studentId, me.schoolId));
  }

  private async inSchool(me: ChatActor, schoolId: string): Promise<boolean> {
    if (!me.schoolId || me.schoolId !== schoolId) return false;
    if (me.isStudent) {
      return (
        !!me.studentId && me.studentSchoolId === schoolId && me.studentActive
      );
    }
    const membership = await this.prisma.school_management.findFirst({
      where: { user_id: me.id, school_id: schoolId },
      select: { id: true },
    });
    if (membership) return true;
    return isOrgAdmin(this.prisma, me.id).catch(() => false);
  }

  // ── Who may message whom ───────────────────────────────────────────────────

  /** A user's school and whether they are a student account. */
  private async actorOf(userId: string): Promise<ChatActor> {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true, account_type: true },
    });
    const isStudent = profile?.account_type === 'student';
    let schoolId = profile?.school_id ?? null;
    let studentId: string | null = null;
    let studentSchoolId: string | null = null;
    let studentActive = false;
    if (isStudent) {
      const student = await this.prisma.student.findFirst({
        where: { user_profile_id: userId },
        select: { id: true, school_id: true, is_active: true },
      });
      studentId = student?.id ?? null;
      studentSchoolId = student?.school_id ?? null;
      studentActive = !!student && student.is_active !== false;
      schoolId = schoolId ?? studentSchoolId;
    }
    return {
      id: userId,
      schoolId,
      isStudent,
      studentId,
      studentSchoolId,
      studentActive,
    };
  }

  /** The ids among `userIds` that belong to student accounts. */
  async studentAccountsAmong(userIds: string[]): Promise<Set<string>> {
    const ids = userIds.filter(isUuid);
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.user_profile.findMany({
      where: { id: { in: ids }, account_type: 'student' },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** Staff (profile ids) teaching a course the student is actively in. */
  private async teachersOf(studentId: string, schoolId: string) {
    const rows = await this.prisma.course_staff.findMany({
      where: {
        course: {
          school_id: schoolId,
          course_student: { some: { student_id: studentId, status: 'active' } },
        },
      },
      select: { user_profile_id: true },
    });
    return [...new Set(rows.map((r) => r.user_profile_id))];
  }

  /** Student accounts actively enrolled in a course this staff member teaches. */
  private async taughtStudentUserIds(staffId: string, schoolId: string) {
    const rows = await this.prisma.student.findMany({
      where: {
        school_id: schoolId,
        user_profile_id: { not: null },
        NOT: { is_active: false },
        course_student: {
          some: {
            status: 'active',
            course: {
              school_id: schoolId,
              course_staff: { some: { user_profile_id: staffId } },
            },
          },
        },
      },
      select: { user_profile_id: true },
    });
    return [
      ...new Set(
        rows.map((r) => r.user_profile_id).filter((id): id is string => !!id),
      ),
    ];
  }

  /** Whether the staff member teaches the student (an active enrolment). */
  private async teaches(
    staffId: string,
    studentUserId: string,
    schoolId: string,
  ): Promise<boolean> {
    const count = await this.prisma.course_staff.count({
      where: {
        user_profile_id: staffId,
        course: {
          school_id: schoolId,
          course_student: {
            some: { status: 'active', student: { user_profile_id: studentUserId } },
          },
        },
      },
    });
    return count > 0;
  }

  /**
   * Starting a DM: staff with staff always; anything with a student needs
   * `student_messaging`, and the staff member must teach the student. Two
   * students never. An existing staff/student DM may be reopened without
   * the teaching check (the reply rule), while the feature is on.
   */
  private async assertDirectAllowed(
    me: ChatActor,
    other: ChatActor,
    schoolId: string,
    exists: boolean,
  ): Promise<void> {
    if (!me.isStudent && !other.isStudent) return;
    if (me.isStudent && other.isStudent) {
      throw new ForbiddenException('Students cannot message each other');
    }
    await this.features.assertEnabled(schoolId, 'student_messaging');
    if (exists) return;
    if (me.isStudent) {
      if (!(await this.teaches(other.id, me.id, schoolId))) {
        throw new ForbiddenException('You can only message your teachers');
      }
    } else if (!(await this.teaches(me.id, other.id, schoolId))) {
      throw new ForbiddenException('You can only message students you teach');
    }
  }

  /**
   * Posting to a conversation the caller belongs to. Channels need
   * `chat_channels` and are for staff. In a DM a student may only write to
   * staff (the reply rule: teaching is not re-checked), and anything a
   * student would read needs `student_messaging`.
   */
  private async assertCanPost(
    userId: string,
    conversation: ConversationRow,
  ): Promise<void> {
    if (conversation.type === 'channel') {
      await this.features.assertEnabled(conversation.school_id, 'chat_channels');
      return;
    }
    const others = (await this.memberIds(conversation.id)).filter(
      (id) => id !== userId,
    );
    const students = await this.studentAccountsAmong([userId, ...others]);
    const meStudent = students.has(userId);
    const otherStudent = others.some((id) => students.has(id));
    if (!meStudent && !otherStudent) return;
    if (meStudent && (otherStudent || others.length === 0)) {
      throw new ForbiddenException('Students cannot message each other');
    }
    await this.features.assertEnabled(
      conversation.school_id,
      'student_messaging',
    );
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

  /** The user's memberships in conversations of one school. */
  private async membershipsOf(
    userId: string,
    schoolId: string,
  ): Promise<{ conversation_id: string; last_read_at: string | null }[]> {
    const rows = await this.prisma.conversation_member.findMany({
      where: { user_id: userId, conversation: { school_id: schoolId } },
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

  /**
   * The newest message of each conversation in a fixed number of queries
   * whatever the number of conversations: the newest `created_at` per
   * conversation (a grouped max over idx_message_conversation), then those
   * rows. Same order as `lastMessageFor` (created_at DESC NULLS FIRST): a
   * message without a timestamp wins, and exact ties go to the lowest id. Falls
   * back to one query per conversation if the batch fails.
   */
  private async lastMessagesFor(
    conversationIds: string[],
  ): Promise<Map<string, ChatMessage>> {
    const map = new Map<string, ChatMessage>();
    if (conversationIds.length === 0) return map;
    try {
      const [newest, undated] = await Promise.all([
        this.prisma.message.groupBy({
          by: ['conversation_id'],
          where: { conversation_id: { in: conversationIds } },
          _max: { created_at: true },
        }),
        this.prisma.message.findMany({
          where: { conversation_id: { in: conversationIds }, created_at: null },
          orderBy: { id: 'asc' },
          select: MESSAGE_SELECT,
        }),
      ]);
      const picked = new Map<string, (typeof undated)[number]>();
      for (const row of undated) {
        if (!picked.has(row.conversation_id)) picked.set(row.conversation_id, row);
      }
      const latest = newest.filter(
        (g) => !picked.has(g.conversation_id) && g._max.created_at,
      );
      if (latest.length > 0) {
        // A range, not equality: the max comes back at JavaScript's
        // millisecond precision while the column keeps microseconds, so
        // match the last millisecond or so and let the database order those
        // few rows at full precision.
        const rows = await this.prisma.message.findMany({
          where: {
            OR: latest.map((g) => ({
              conversation_id: g.conversation_id,
              created_at: { gte: new Date(g._max.created_at!.getTime() - 1) },
            })),
          },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
          select: MESSAGE_SELECT,
        });
        for (const row of rows) {
          if (!picked.has(row.conversation_id)) picked.set(row.conversation_id, row);
        }
      }
      for (const [id, row] of picked) {
        map.set(id, this.presentMessage(toMessageRow(row)));
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `batched last-message query failed, falling back to per-conversation: ${String(err)}`,
      );
      const entries = await Promise.all(
        conversationIds.map(
          async (id) => [id, await this.lastMessageFor(id)] as const,
        ),
      );
      for (const [id, message] of entries) if (message) map.set(id, message);
      return map;
    }
  }

  /**
   * Unread messages per membership in one grouped count: messages from
   * someone else, not deleted, newer than the member's read marker (all of
   * them when the member has never read the conversation). Every membership
   * passed gets an entry, 0 when nothing is unread. Falls back to one count
   * per conversation if the grouped query fails.
   */
  private async unreadCountsFor(
    userId: string,
    memberships: { conversation_id: string; last_read_at: string | null }[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>(
      memberships.map((m) => [m.conversation_id, 0]),
    );
    if (memberships.length === 0) return map;
    const neverRead = memberships
      .filter((m) => !m.last_read_at)
      .map((m) => m.conversation_id);
    const scopes = [
      ...(neverRead.length > 0 ? [{ conversation_id: { in: neverRead } }] : []),
      ...memberships
        .filter((m) => m.last_read_at)
        .map((m) => ({
          conversation_id: m.conversation_id,
          created_at: { gt: new Date(m.last_read_at!) },
        })),
    ];
    try {
      const rows = await this.prisma.message.groupBy({
        by: ['conversation_id'],
        where: { sender_id: { not: userId }, deleted_at: null, OR: scopes },
        _count: { _all: true },
      });
      for (const row of rows) {
        if (map.has(row.conversation_id)) {
          map.set(row.conversation_id, row._count._all);
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `grouped unread count failed, falling back to per-conversation counts: ${String(err)}`,
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
