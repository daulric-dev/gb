import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatEventType } from './chat.constants';
import { expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const ME = '00000000-0000-4000-8000-000000000001';
const YOU = '00000000-0000-4000-8000-000000000002';
const THEM = '00000000-0000-4000-8000-000000000003';
const CONV = '10000000-0000-4000-8000-000000000001';
const MSG = '20000000-0000-4000-8000-000000000001';
const T0 = new Date('2026-10-01T10:00:00.000Z');

/** A visible fake: encrypt wraps, decrypt unwraps. */
const fakeCipher = () => ({
  encrypt: mock((s: string | null) => (s === null ? null : `enc(${s})`)),
  decrypt: mock((s: string | null) =>
    s !== null && s.startsWith('enc(') ? s.slice(4, -1) : s,
  ),
});

function convRow(over: Record<string, unknown> = {}) {
  return {
    id: CONV,
    school_id: 'school-1',
    type: 'direct',
    title: null,
    direct_key: ChatService.directKey(ME, YOU),
    created_by: ME,
    created_at: T0,
    last_message_at: T0,
    ...over,
  };
}

function msgRow(over: Record<string, unknown> = {}) {
  return {
    id: MSG,
    conversation_id: CONV,
    sender_id: ME,
    type: 'text',
    body: 'enc(hello)',
    metadata: {},
    action_state: null,
    created_at: T0,
    edited_at: null,
    deleted_at: null,
    ...over,
  };
}

describe('ChatService', () => {
  let prisma: MockPrisma;
  let realtime: { publishToUsers: ReturnType<typeof mock> };
  let cipher: ReturnType<typeof fakeCipher>;
  let service: ChatService;

  /** Profiles: ME and YOU in school-1, THEM in school-2. */
  const schools: Record<string, string | null> = {
    [ME]: 'school-1',
    [YOU]: 'school-1',
    [THEM]: 'school-2',
  };

  /** Make `userId` a member of CONV (or of nothing). */
  const memberOf = (...userIds: string[]) => {
    prisma.conversation_member.findUnique.mockImplementation(async ({ where }) => {
      const key = where.conversation_id_user_id;
      return key.conversation_id === CONV && userIds.includes(key.user_id)
        ? { id: 'm', last_read_at: null }
        : null;
    });
    prisma.conversation_member.findMany.mockImplementation(async ({ where }) =>
      where.conversation_id === CONV ||
      where.conversation_id?.in?.includes(CONV)
        ? userIds.map((u) => ({ conversation_id: CONV, user_id: u }))
        : [],
    );
  };

  const published = () =>
    realtime.publishToUsers.mock.calls.map((c) => ({
      to: c[0] as string[],
      type: (c[1] as { type: string }).type,
      data: (c[1] as { data: unknown }).data,
    }));

  beforeEach(() => {
    prisma = createMockPrisma();
    realtime = { publishToUsers: mock(async () => undefined) };
    cipher = fakeCipher();
    prisma.user_profile.findUnique.mockImplementation(async ({ where }) =>
      where.id in schools ? { school_id: schools[where.id] } : null,
    );
    prisma.conversation.findUnique.mockResolvedValue(convRow());
    prisma.message.create.mockImplementation(async ({ data }) =>
      msgRow({
        id: MSG,
        conversation_id: data.conversation_id,
        sender_id: data.sender_id,
        type: data.type,
        body: data.body,
        metadata: data.metadata,
        action_state: data.action_state,
      }),
    );
    service = new ChatService(prisma as any, realtime as any, cipher as any, createMockErasureLog() as any);
  });

  describe('directKey', () => {
    test('is order independent', () => {
      expect(ChatService.directKey(YOU, ME)).toBe(`${ME}:${YOU}`);
      expect(ChatService.directKey(ME, YOU)).toBe(`${ME}:${YOU}`);
    });
  });

  describe('listMessageableUsers', () => {
    test('active users of the caller school, excluding the caller', async () => {
      prisma.user_profile.findMany.mockResolvedValue([
        { id: YOU, first_name: 'Ada', last_name: 'L', avatar_url: null },
      ]);
      expect(await service.listMessageableUsers(ME)).toEqual([
        { userId: YOU, firstName: 'Ada', lastName: 'L', avatarUrl: null },
      ]);
      const arg = prisma.user_profile.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        school_id: 'school-1',
        is_active: true,
        id: { not: ME },
      });
      expect(arg.orderBy).toEqual({ first_name: 'asc' });
    });

    test('a user without a school is a server error', async () => {
      const err = await expectRejection(service.listMessageableUsers('nobody'));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getOrCreateDirect', () => {
    test('cannot message yourself', async () => {
      const err = await expectRejection(service.getOrCreateDirect(ME, ME));
      expect(err).toBeInstanceOf(BadRequestException);
    });

    test('403 for a user in another school', async () => {
      const err = await expectRejection(service.getOrCreateDirect(ME, THEM));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    test('403 for an unknown or malformed user id (without querying it)', async () => {
      const err = await expectRejection(service.getOrCreateDirect(ME, 'not-a-uuid'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(
        prisma.user_profile.findUnique.mock.calls.some(
          (c) => c[0].where.id === 'not-a-uuid',
        ),
      ).toBe(false);
    });

    test('reuses an existing DM without creating or publishing', async () => {
      prisma.conversation.findFirst.mockResolvedValue(convRow());
      const res = await service.getOrCreateDirect(ME, YOU);
      expect(res.id).toBe(CONV);
      expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
        type: 'direct',
        direct_key: `${ME}:${YOU}`,
      });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });

    test('creates a DM with owner + member and tells both sides', async () => {
      prisma.conversation.create.mockResolvedValue(convRow());
      memberOf(ME, YOU);
      prisma.user_profile.findMany.mockResolvedValue([
        { id: ME, first_name: 'Me', last_name: null, avatar_url: null },
        { id: YOU, first_name: 'You', last_name: null, avatar_url: null },
      ]);

      const res = await service.getOrCreateDirect(ME, YOU);

      expect(prisma.conversation.create.mock.calls[0][0].data).toEqual({
        school_id: 'school-1',
        type: 'direct',
        direct_key: `${ME}:${YOU}`,
        created_by: ME,
      });
      expect(prisma.conversation_member.createMany.mock.calls[0][0].data).toEqual([
        { conversation_id: CONV, user_id: ME, role: 'owner' },
        { conversation_id: CONV, user_id: YOU, role: 'member' },
      ]);
      expect(res).toMatchObject({
        id: CONV,
        type: 'direct',
        title: null,
        lastMessageAt: T0.toISOString(),
        lastMessage: null,
        unreadCount: 0,
      });
      expect(res.participants.map((p) => p.userId)).toEqual([ME, YOU]);
      expect(published()).toEqual([
        { to: [ME, YOU], type: ChatEventType.Conversation, data: res },
      ]);
    });

    test('a lost create race reuses the conversation that won', async () => {
      prisma.conversation.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(convRow({ id: CONV }));
      prisma.conversation.create.mockRejectedValue(new Error('unique'));
      const res = await service.getOrCreateDirect(ME, YOU);
      expect(res.id).toBe(CONV);
      expect(prisma.conversation_member.createMany).not.toHaveBeenCalled();
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });

    test('a create failure with no winner is a 400', async () => {
      prisma.conversation.create.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.getOrCreateDirect(ME, YOU));
      expect((err as Error).message).toBe('Failed to start conversation');
    });

    test('a member insert failure is a 400 and nothing is published', async () => {
      prisma.conversation.create.mockResolvedValue(convRow());
      prisma.conversation_member.createMany.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.getOrCreateDirect(ME, YOU));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });
  });

  describe('createChannel', () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.CHAT_CHANNELS_ENABLED;
      process.env.CHAT_CHANNELS_ENABLED = 'true';
      prisma.conversation.create.mockResolvedValue(
        convRow({ type: 'channel', title: 'Staff', direct_key: null }),
      );
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.CHAT_CHANNELS_ENABLED;
      else process.env.CHAT_CHANNELS_ENABLED = saved;
    });

    test('403 when the feature flag is off', async () => {
      process.env.CHAT_CHANNELS_ENABLED = 'false';
      const err = await expectRejection(service.createChannel(ME, 'x', [YOU]));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe('Channels are not enabled');
    });

    test('403 when a member is outside the school', async () => {
      prisma.user_profile.findMany.mockResolvedValue([{ id: YOU }]);
      const err = await expectRejection(
        service.createChannel(ME, 'Staff', [YOU, THEM]),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.user_profile.findMany.mock.calls[0][0].where).toEqual({
        id: { in: [YOU, THEM] },
        school_id: 'school-1',
      });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    test('403 for a malformed member id without querying', async () => {
      const err = await expectRejection(
        service.createChannel(ME, 'Staff', ['bogus']),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.user_profile.findMany).not.toHaveBeenCalled();
    });

    test('creates the channel, dedupes members, creator is owner, fans out', async () => {
      prisma.user_profile.findMany.mockResolvedValue([{ id: YOU }]);
      const res = await service.createChannel(ME, 'Staff', [YOU, YOU, ME]);
      expect(prisma.conversation.create.mock.calls[0][0].data).toEqual({
        school_id: 'school-1',
        type: 'channel',
        title: 'Staff',
        created_by: ME,
      });
      expect(prisma.conversation_member.createMany.mock.calls[0][0].data).toEqual([
        { conversation_id: CONV, user_id: ME, role: 'owner' },
        { conversation_id: CONV, user_id: YOU, role: 'member' },
      ]);
      expect(res.type).toBe('channel');
      expect(published()).toEqual([
        { to: [ME, YOU], type: ChatEventType.Conversation, data: res },
      ]);
    });

    test('a channel with only the creator skips the school check', async () => {
      await service.createChannel(ME, 'Solo', []);
      expect(prisma.user_profile.findMany).toHaveBeenCalledTimes(1); // participants only
      expect(prisma.conversation_member.createMany.mock.calls[0][0].data).toEqual([
        { conversation_id: CONV, user_id: ME, role: 'owner' },
      ]);
    });

    test('a create failure is a 400', async () => {
      prisma.conversation.create.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.createChannel(ME, 'Solo', []));
      expect((err as Error).message).toBe('Failed to create channel');
    });
  });

  describe('membership checks', () => {
    test('listMessages is 403 for a non-member', async () => {
      memberOf(YOU);
      const err = await expectRejection(service.listMessages(ME, CONV));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    test('a malformed conversation id is 403 without a query', async () => {
      const err = await expectRejection(service.sendMessage(ME, 'nope', 'hi'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.conversation_member.findUnique).not.toHaveBeenCalled();
    });

    test('member but the conversation row is gone: 404', async () => {
      memberOf(ME);
      prisma.conversation.findUnique.mockResolvedValue(null);
      const err = await expectRejection(service.markRead(ME, CONV));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('markRead is 403 for a non-member', async () => {
      memberOf(YOU);
      expect(await expectRejection(service.markRead(ME, CONV))).toBeInstanceOf(
        ForbiddenException,
      );
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });
  });

  describe('listMessages', () => {
    beforeEach(() => memberOf(ME, YOU));

    test('newest first, default limit 30, bodies decrypted', async () => {
      prisma.message.findMany.mockResolvedValue([
        msgRow({ metadata: null }),
      ]);
      const res = await service.listMessages(ME, CONV);
      const arg = prisma.message.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ conversation_id: CONV });
      expect(arg.take).toBe(30);
      expect(arg.orderBy).toEqual({ created_at: { sort: 'desc', nulls: 'first' } });
      expect(res).toEqual([
        {
          id: MSG,
          conversationId: CONV,
          senderId: ME,
          type: 'text',
          body: 'hello',
          metadata: {},
          actionState: null,
          createdAt: T0.toISOString(),
          editedAt: null,
          deletedAt: null,
        },
      ]);
    });

    test('limit is capped at 100 and before becomes a created_at cursor', async () => {
      await service.listMessages(ME, CONV, {
        limit: 500,
        before: '2026-10-01T09:00:00.000Z',
      });
      const arg = prisma.message.findMany.mock.calls[0][0];
      expect(arg.take).toBe(100);
      expect(arg.where.created_at).toEqual({
        lt: new Date('2026-10-01T09:00:00.000Z'),
      });
    });

    test('a smaller limit is honoured', async () => {
      await service.listMessages(ME, CONV, { limit: 5 });
      expect(prisma.message.findMany.mock.calls[0][0].take).toBe(5);
    });
  });

  describe('sendMessage / postMessage', () => {
    beforeEach(() => memberOf(ME, YOU));

    test('encrypts the body at rest and returns it decrypted', async () => {
      const res = await service.sendMessage(ME, CONV, 'hi there');
      const data = prisma.message.create.mock.calls[0][0].data;
      expect(data).toEqual({
        conversation_id: CONV,
        school_id: 'school-1',
        sender_id: ME,
        type: 'text',
        body: 'enc(hi there)',
        metadata: {},
        action_state: null,
      });
      expect(cipher.encrypt).toHaveBeenCalledWith('hi there');
      expect(res.body).toBe('hi there');
      expect(res.senderId).toBe(ME);
    });

    test('bumps the conversation and marks the sender read', async () => {
      await service.sendMessage(ME, CONV, 'hi');
      const bump = prisma.conversation.updateMany.mock.calls[0][0];
      expect(bump.where).toEqual({ id: CONV });
      expect(bump.data.last_message_at).toBeInstanceOf(Date);
      const read = prisma.conversation_member.updateMany.mock.calls[0][0];
      expect(read.where).toEqual({ conversation_id: CONV, user_id: ME });
      expect(read.data.last_read_at).toBeInstanceOf(Date);
    });

    test('fans the message out to every member', async () => {
      const res = await service.sendMessage(ME, CONV, 'hi');
      expect(published()).toEqual([
        { to: [ME, YOU], type: ChatEventType.Message, data: res },
      ]);
    });

    test('bookkeeping failures do not fail the send', async () => {
      prisma.conversation.updateMany.mockRejectedValue(new Error('x'));
      prisma.conversation_member.updateMany.mockRejectedValue(new Error('y'));
      const res = await service.sendMessage(ME, CONV, 'hi');
      expect(res.body).toBe('hi');
      expect(realtime.publishToUsers).toHaveBeenCalledTimes(1);
    });

    test('an insert failure is a 400 and nothing is fanned out', async () => {
      prisma.message.create.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.sendMessage(ME, CONV, 'hi'));
      expect((err as Error).message).toBe('Failed to send message');
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });

    test('postMessage passes metadata and action state through', async () => {
      const conversation = await service.loadConversation(CONV);
      const res = await service.postMessage({
        conversation,
        senderId: ME,
        type: 'file_share',
        body: 'shared',
        metadata: { fileId: 'f1' },
        actionState: 'pending',
      });
      const data = prisma.message.create.mock.calls[0][0].data;
      expect(data.metadata).toEqual({ fileId: 'f1' });
      expect(data.action_state).toBe('pending');
      expect(res.actionState).toBe('pending');
      expect(res.metadata).toEqual({ fileId: 'f1' });
    });
  });

  describe('editMessage', () => {
    beforeEach(() => {
      memberOf(ME, YOU);
      prisma.message.findUnique.mockResolvedValue(msgRow());
      prisma.message.update.mockImplementation(async ({ data }) =>
        msgRow({ ...data }),
      );
    });

    test('encrypts the new body, stamps edited_at and fans out', async () => {
      const res = await service.editMessage(ME, MSG, 'edited');
      const arg = prisma.message.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: MSG });
      expect(arg.data.body).toBe('enc(edited)');
      expect(arg.data.edited_at).toBeInstanceOf(Date);
      expect(res.body).toBe('edited');
      expect(res.editedAt).not.toBeNull();
      expect(published()).toEqual([
        { to: [ME, YOU], type: ChatEventType.Message, data: res },
      ]);
    });

    test("403 for someone else's message", async () => {
      const err = await expectRejection(service.editMessage(YOU, MSG, 'x'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    test('404 for a missing or malformed message id', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      expect(await expectRejection(service.editMessage(ME, MSG, 'x'))).toBeInstanceOf(
        NotFoundException,
      );
      expect(
        await expectRejection(service.editMessage(ME, 'bad-id', 'x')),
      ).toBeInstanceOf(NotFoundException);
    });

    test('an update failure is a 400 and nothing is fanned out', async () => {
      prisma.message.update.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.editMessage(ME, MSG, 'x'));
      expect((err as Error).message).toBe('Failed to edit message');
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });

    test('editing a soft-deleted message is rejected', async () => {
      prisma.message.findUnique.mockResolvedValue(
        msgRow({ body: null, deleted_at: T0 }),
      );
      await expectRejection(service.editMessage(ME, MSG, 'back from the dead'));
      expect(prisma.message.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteMessage', () => {
    beforeEach(() => {
      memberOf(ME, YOU);
      prisma.message.findUnique.mockResolvedValue(msgRow());
      prisma.message.update.mockImplementation(async ({ data }) =>
        msgRow({ ...data }),
      );
    });

    test('soft-deletes (clears body, sets deleted_at) and fans out', async () => {
      const res = await service.deleteMessage(ME, MSG);
      const arg = prisma.message.update.mock.calls[0][0];
      expect(arg.data.body).toBeNull();
      expect(arg.data.deleted_at).toBeInstanceOf(Date);
      expect(prisma.message.delete).not.toHaveBeenCalled();
      expect(res.body).toBeNull();
      expect(res.deletedAt).not.toBeNull();
      expect(published()[0].type).toBe(ChatEventType.Message);
    });

    test("403 for someone else's message", async () => {
      const err = await expectRejection(service.deleteMessage(YOU, MSG));
      expect(err).toBeInstanceOf(ForbiddenException);
    });

    test('an update failure is a 400', async () => {
      prisma.message.update.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.deleteMessage(ME, MSG));
      expect((err as Error).message).toBe('Failed to delete message');
    });
  });

  describe('markRead', () => {
    beforeEach(() => memberOf(ME, YOU));

    test('moves the marker and tells only the caller', async () => {
      const res = await service.markRead(ME, CONV);
      expect(res.ok).toBe(true);
      const arg = prisma.conversation_member.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ conversation_id: CONV, user_id: ME });
      expect(arg.data.last_read_at.toISOString()).toBe(res.lastReadAt);
      expect(published()).toEqual([
        {
          to: [ME],
          type: ChatEventType.Read,
          data: { conversationId: CONV, userId: ME, lastReadAt: res.lastReadAt },
        },
      ]);
    });

    test('a marker write failure is logged, not thrown', async () => {
      prisma.conversation_member.updateMany.mockRejectedValue(new Error('db'));
      expect((await service.markRead(ME, CONV)).ok).toBe(true);
    });
  });

  describe('unread counts', () => {
    test('totalUnread is 0 with no memberships, without calling the RPC', async () => {
      expect(await service.totalUnread(ME)).toEqual({ count: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    test('totalUnread sums the RPC rows (bigint safe)', async () => {
      prisma.conversation_member.findMany.mockResolvedValue([
        { conversation_id: CONV, last_read_at: null },
        { conversation_id: 'c2', last_read_at: null },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        { conversation_id: CONV, unread: BigInt(3) },
        { conversation_id: 'c2', unread: 2 },
      ]);
      expect(await service.totalUnread(ME)).toEqual({ count: 5 });
      // The user id is a bound value, not spliced into the SQL.
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([ME]);
    });

    test('falls back to per-conversation counts when the RPC fails', async () => {
      const read = new Date('2026-10-01T08:00:00.000Z');
      prisma.conversation_member.findMany.mockResolvedValue([
        { conversation_id: CONV, last_read_at: read },
        { conversation_id: 'c2', last_read_at: null },
      ]);
      prisma.$queryRaw.mockRejectedValue(new Error('no function'));
      prisma.message.count.mockImplementation(async ({ where }) =>
        where.conversation_id === CONV ? 4 : 1,
      );
      expect(await service.totalUnread(ME)).toEqual({ count: 5 });
      const calls = prisma.message.count.mock.calls.map((c) => c[0].where);
      expect(calls[0]).toEqual({
        conversation_id: CONV,
        sender_id: { not: ME },
        deleted_at: null,
        created_at: { gt: read },
      });
      expect(calls[1]).toEqual({
        conversation_id: 'c2',
        sender_id: { not: ME },
        deleted_at: null,
      });
    });

    test('a failing fallback count counts as 0', async () => {
      prisma.conversation_member.findMany.mockResolvedValue([
        { conversation_id: CONV, last_read_at: null },
      ]);
      prisma.$queryRaw.mockRejectedValue(new Error('no function'));
      prisma.message.count.mockRejectedValue(new Error('db'));
      expect(await service.totalUnread(ME)).toEqual({ count: 0 });
    });
  });

  describe('listConversations', () => {
    test('empty without memberships', async () => {
      expect(await service.listConversations(ME)).toEqual([]);
      expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    test('summaries with participants, last message and unread', async () => {
      const C2 = '10000000-0000-4000-8000-000000000002';
      prisma.conversation_member.findMany.mockImplementation(async ({ where }) =>
        where.user_id
          ? [
              { conversation_id: CONV, last_read_at: null },
              { conversation_id: C2, last_read_at: null },
            ]
          : [
              { conversation_id: CONV, user_id: ME },
              { conversation_id: CONV, user_id: YOU },
              { conversation_id: C2, user_id: ME },
              { conversation_id: C2, user_id: 'deleted-user' },
            ],
      );
      prisma.conversation.findMany.mockResolvedValue([
        convRow({ id: C2, last_message_at: new Date('2026-10-02T00:00:00Z') }),
        convRow(),
      ]);
      prisma.user_profile.findMany.mockResolvedValue([
        { id: ME, first_name: 'Me', last_name: null, avatar_url: null },
        { id: YOU, first_name: 'You', last_name: null, avatar_url: 'a.png' },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ conversation_id: CONV, unread: 2 }]);
      prisma.message.findFirst.mockImplementation(async ({ where }) =>
        where.conversation_id === CONV ? msgRow() : null,
      );

      const res = await service.listConversations(ME);
      expect(res.map((c) => c.id)).toEqual([C2, CONV]);
      expect(prisma.conversation.findMany.mock.calls[0][0].orderBy).toEqual({
        last_message_at: { sort: 'desc', nulls: 'first' },
      });
      const [c2, c1] = res;
      expect(c2.unreadCount).toBe(0);
      expect(c2.lastMessage).toBeNull();
      // A member without a profile is left out.
      expect(c2.participants.map((p) => p.userId)).toEqual([ME]);
      expect(c1.unreadCount).toBe(2);
      expect(c1.lastMessage?.body).toBe('hello');
      expect(c1.participants).toEqual([
        { userId: ME, firstName: 'Me', lastName: null, avatarUrl: null },
        { userId: YOU, firstName: 'You', lastName: null, avatarUrl: 'a.png' },
      ]);
    });
  });

  describe('setActionState', () => {
    beforeEach(() => {
      memberOf(ME, YOU);
      prisma.message.findUnique.mockResolvedValue({
        id: MSG,
        conversation_id: CONV,
        sender_id: ME,
        action_state: 'pending',
      });
      prisma.message.update.mockImplementation(async ({ data }) =>
        msgRow({ type: 'file_share', ...data }),
      );
    });

    test('the recipient accepts; members get a message_action event', async () => {
      const res = await service.setActionState(YOU, MSG, 'accepted');
      expect(prisma.message.update.mock.calls[0][0].data).toEqual({
        action_state: 'accepted',
      });
      expect(res.actionState).toBe('accepted');
      expect(published()).toEqual([
        { to: [ME, YOU], type: ChatEventType.MessageAction, data: res },
      ]);
    });

    test('the sender cannot act on their own request', async () => {
      const err = await expectRejection(service.setActionState(ME, MSG, 'accepted'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    test('a non-member is 403', async () => {
      const err = await expectRejection(
        service.setActionState(THEM, MSG, 'dismissed'),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe('You are not in this conversation');
    });

    test('a message without an action is 400', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: MSG,
        conversation_id: CONV,
        sender_id: ME,
        action_state: null,
      });
      const err = await expectRejection(service.setActionState(YOU, MSG, 'accepted'));
      expect(err).toBeInstanceOf(BadRequestException);
    });

    test('an answered request cannot be answered again (409)', async () => {
      for (const state of ['accepted', 'dismissed'] as const) {
        prisma.message.findUnique.mockResolvedValue({
          id: MSG,
          conversation_id: CONV,
          sender_id: ME,
          action_state: state,
          deleted_at: null,
        });
        const err = await expectRejection(service.setActionState(YOU, MSG, 'dismissed'));
        expect(err).toBeInstanceOf(ConflictException);
      }
      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    test('a deleted request cannot be answered', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: MSG,
        conversation_id: CONV,
        sender_id: ME,
        action_state: 'pending',
        deleted_at: new Date(),
      });
      const err = await expectRejection(service.setActionState(YOU, MSG, 'accepted'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(prisma.message.update).not.toHaveBeenCalled();
    });

    test('404 for a missing or malformed message', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      expect(
        await expectRejection(service.setActionState(YOU, MSG, 'accepted')),
      ).toBeInstanceOf(NotFoundException);
      expect(
        await expectRejection(service.setActionState(YOU, 'x', 'accepted')),
      ).toBeInstanceOf(NotFoundException);
    });

    test('an update failure is a 400', async () => {
      prisma.message.update.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.setActionState(YOU, MSG, 'dismissed'));
      expect((err as Error).message).toBe('Failed to update action');
    });
  });

  describe('loadConversation / ensureDirectConversationRow', () => {
    test('loadConversation: 404 for a malformed id, without a query', async () => {
      const err = await expectRejection(service.loadConversation('x'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
    });

    test('loadConversation returns ISO timestamps', async () => {
      const row = await service.loadConversation(CONV);
      expect(row.created_at).toBe(T0.toISOString());
      expect(row.last_message_at).toBe(T0.toISOString());
    });

    test('ensureDirect returns an existing DM', async () => {
      prisma.conversation.findFirst.mockResolvedValue(convRow());
      const row = await service.ensureDirectConversationRow('school-1', YOU, ME);
      expect(row.id).toBe(CONV);
      expect(prisma.conversation.findFirst.mock.calls[0][0].where.direct_key).toBe(
        `${ME}:${YOU}`,
      );
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    test('ensureDirect creates one with A as owner, without publishing', async () => {
      prisma.conversation.create.mockResolvedValue(convRow());
      await service.ensureDirectConversationRow('school-1', ME, YOU);
      expect(prisma.conversation.create.mock.calls[0][0].data.created_by).toBe(ME);
      expect(prisma.conversation_member.createMany.mock.calls[0][0].data).toEqual([
        { conversation_id: CONV, user_id: ME, role: 'owner' },
        { conversation_id: CONV, user_id: YOU, role: 'member' },
      ]);
      expect(realtime.publishToUsers).not.toHaveBeenCalled();
    });

    test('ensureDirect reuses the race winner, else 400', async () => {
      prisma.conversation.create.mockRejectedValue(new Error('unique'));
      prisma.conversation.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(convRow());
      expect(
        (await service.ensureDirectConversationRow('school-1', ME, YOU)).id,
      ).toBe(CONV);

      prisma.conversation.findFirst.mockResolvedValue(null);
      const err = await expectRejection(
        service.ensureDirectConversationRow('school-1', ME, YOU),
      );
      expect((err as Error).message).toBe('Failed to open conversation');
    });

    test('ensureDirect swallows a member insert failure', async () => {
      prisma.conversation.create.mockResolvedValue(convRow());
      prisma.conversation_member.createMany.mockRejectedValue(new Error('db'));
      expect(
        (await service.ensureDirectConversationRow('school-1', ME, YOU)).id,
      ).toBe(CONV);
    });
  });
});
