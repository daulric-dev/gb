import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DiscussionService, type DiscussionCtx } from './discussion.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const COURSE = { id: 'course-1', school_id: 'school-1', status: 'published' } as any;

const TOPIC = {
  id: 'topic-1',
  course_id: 'course-1',
  author_user_profile_id: 'teacher-1',
  title: 'Cell walls',
  body: '',
  is_pinned: false,
  is_locked: false,
  is_published: true,
  require_initial_post: false,
  last_reply_at: null,
  edited_at: null,
  created_at: new Date('2026-10-20'),
  updated_at: new Date('2026-10-20'),
  user_profile: null,
};

const reply = (id: string, author: string, extra: Record<string, unknown> = {}) => ({
  id,
  topic_id: 'topic-1',
  parent_id: null,
  author_user_profile_id: author,
  body: `from ${author}`,
  edited_at: null,
  deleted_at: null,
  created_at: new Date('2026-10-21'),
  user_profile: {
    first_name: 'A',
    last_name: 'B',
    avatar_url: null,
    account_type: author.startsWith('student') ? 'student' : 'staff',
  },
  ...extra,
});

const ctx = (
  role: DiscussionCtx['role'],
  userId: string,
  course = COURSE,
): DiscussionCtx => ({ course, userId, role });

function service(prisma: MockPrisma) {
  return new DiscussionService(prisma as any, {} as any);
}

function seed(prisma: MockPrisma, topic = TOPIC) {
  prisma.discussion_topic.findFirst.mockResolvedValue(topic);
  prisma.discussion_reply.findFirst.mockResolvedValue({
    id: 'reply-1',
    parent_id: null,
    author_user_profile_id: 'student-1',
  });
  prisma.discussion_reply.update.mockImplementation(async ({ data }: any) =>
    reply('reply-1', 'student-1', data),
  );
  prisma.discussion_reply.create.mockImplementation(async ({ data }: any) =>
    reply('new', data.author_user_profile_id, { parent_id: data.parent_id }),
  );
}

describe('DiscussionService', () => {
  test("a student cannot edit another student's reply", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const err = await expectRejection(
      service(prisma).updateReply(ctx('student', 'student-2'), 'topic-1', 'reply-1', { body: 'x' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(prisma.discussion_reply.update).not.toHaveBeenCalled();
  });

  test("a TA cannot edit a student's reply; a teacher can", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const err = await expectRejection(
      service(prisma).updateReply(ctx('ta', 'ta-1'), 'topic-1', 'reply-1', { body: 'x' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);

    const out = await service(prisma).updateReply(
      ctx('teacher', 'teacher-1'),
      'topic-1',
      'reply-1',
      { body: 'Fixed' },
    );
    expect(out.body).toBe('Fixed');
    expect(out.editedAt).not.toBeNull();
  });

  test('a reply that has answers is blanked, not removed', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.discussion_reply.count.mockResolvedValue(2);
    await service(prisma).removeReply(ctx('teacher', 'teacher-1'), 'topic-1', 'reply-1');
    const call = prisma.discussion_reply.update.mock.calls[0][0];
    expect(call.data.body).toBe('');
    expect(call.data.deleted_at).toBeInstanceOf(Date);
    expect(prisma.discussion_reply.deleteMany).not.toHaveBeenCalled();
  });

  test('removing the last answer under a deleted post takes the placeholder', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.discussion_reply.findFirst.mockResolvedValue({
      id: 'reply-2',
      parent_id: 'reply-1',
      author_user_profile_id: 'student-1',
    });
    prisma.discussion_reply.findUnique.mockResolvedValue({
      deleted_at: new Date(),
      _count: { children: 0 },
    });
    await service(prisma).removeReply(ctx('student', 'student-1'), 'topic-1', 'reply-2');
    const deleted = prisma.discussion_reply.deleteMany.mock.calls.map((c) => c[0].where.id);
    expect(deleted).toEqual(['reply-2', 'reply-1']);
  });

  test('answering a nested reply joins its thread (one level deep)', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.discussion_reply.findFirst.mockResolvedValue({
      id: 'reply-2',
      parent_id: 'reply-1',
      deleted_at: null,
    });
    const out = await service(prisma).reply(ctx('student', 'student-1'), 'topic-1', {
      body: 'Me too',
      parentId: 'reply-2',
    });
    expect(out.parentId).toBe('reply-1');
  });

  test('a locked topic takes replies from moderators only', async () => {
    const prisma = createMockPrisma();
    seed(prisma, { ...TOPIC, is_locked: true });
    const err = await expectRejection(
      service(prisma).reply(ctx('student', 'student-1'), 'topic-1', { body: 'hi' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);

    const out = await service(prisma).reply(ctx('teacher', 'teacher-1'), 'topic-1', {
      body: 'Closing this',
    });
    expect(out.isMine).toBe(true);
  });

  test('an archived course takes no new replies', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const archived = { ...COURSE, status: 'archived' };
    const err = await expectRejection(
      service(prisma).reply(ctx('student', 'student-1', archived), 'topic-1', { body: 'hi' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test("students see others' replies only after posting when the topic asks", async () => {
    const prisma = createMockPrisma();
    seed(prisma, { ...TOPIC, require_initial_post: true });
    prisma.discussion_reply.findMany.mockResolvedValue([reply('r1', 'student-2')]);

    const before = await service(prisma).get(ctx('student', 'student-1'), 'topic-1');
    expect(before.mustPostFirst).toBe(true);
    expect(before.replies).toEqual([]);
    expect(prisma.discussion_read.upsert).not.toHaveBeenCalled();

    prisma.discussion_reply.findMany.mockResolvedValue([
      reply('r1', 'student-2'),
      reply('r2', 'student-1'),
    ]);
    const after = await service(prisma).get(ctx('student', 'student-1'), 'topic-1');
    expect(after.mustPostFirst).toBe(false);
    expect(after.replies).toHaveLength(2);
    expect(prisma.discussion_read.upsert).toHaveBeenCalled();
  });

  test('the thread nests answers and shows deleted posts without author', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.discussion_reply.findMany.mockResolvedValue([
      reply('r1', 'student-2', { deleted_at: new Date(), body: '' }),
      reply('r2', 'student-1', { parent_id: 'r1' }),
    ]);
    const out = await service(prisma).get(ctx('teacher', 'teacher-1'), 'topic-1');
    expect(out.replies).toHaveLength(1);
    expect(out.replies[0].isDeleted).toBe(true);
    expect(out.replies[0].author).toBeNull();
    expect(out.replies[0].replies[0].id).toBe('r2');
    expect(out.replyCount).toBe(1);
  });

  test('students start topics only when the course allows it', async () => {
    const prisma = createMockPrisma();
    const err = await expectRejection(
      service(prisma).create(ctx('student', 'student-1'), { title: 'Q' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);

    prisma.discussion_setting.findUnique.mockResolvedValue({
      students_can_create_topics: true,
    });
    prisma.discussion_topic.create.mockImplementation(async ({ data }: any) => ({
      ...TOPIC,
      ...data,
    }));
    const out = await service(prisma).create(ctx('student', 'student-1'), {
      title: 'Q',
      isPinned: true,
    });
    // Moderation flags are ignored for a student's topic.
    expect(out.isPinned).toBe(false);
    expect(out.isPublished).toBe(true);
  });

  test('a student cannot change topic settings on their own topic', async () => {
    const prisma = createMockPrisma();
    seed(prisma, { ...TOPIC, author_user_profile_id: 'student-1' });
    const err = await expectRejection(
      service(prisma).update(ctx('student', 'student-1'), 'topic-1', { isPinned: true }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test("a student cannot delete their topic once others have replied", async () => {
    const prisma = createMockPrisma();
    seed(prisma, { ...TOPIC, author_user_profile_id: 'student-1' });
    prisma.discussion_reply.count.mockResolvedValue(1);
    const err = await expectRejection(
      service(prisma).remove(ctx('student', 'student-1'), 'topic-1'),
    );
    expect(err).toBeInstanceOf(ConflictException);
  });

  test('a draft topic is missing for students', async () => {
    const prisma = createMockPrisma();
    const err = await expectRejection(
      service(prisma).get(ctx('student', 'student-1'), 'topic-1'),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.discussion_topic.findFirst.mock.calls[0][0].where).toEqual({
      id: 'topic-1',
      course_id: 'course-1',
      is_published: true,
    });
  });

  test('replying to a deleted post is refused', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.discussion_reply.findFirst.mockResolvedValue({
      id: 'reply-1',
      parent_id: null,
      deleted_at: new Date(),
    });
    const err = await expectRejection(
      service(prisma).reply(ctx('student', 'student-1'), 'topic-1', {
        body: 'hi',
        parentId: 'reply-1',
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
  });
});
