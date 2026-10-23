import { describe, expect, test } from 'bun:test';
import { CourseNotificationService } from './course-notification.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

function setup(opts: { status?: string; already?: string[] } = {}) {
  const prisma = createMockPrisma();
  prisma.course.findUnique.mockResolvedValue({
    id: 'course-1',
    name: 'Biology 101',
    status: opts.status ?? 'published',
  });
  prisma.course_student.findMany.mockResolvedValue([
    { student_id: 's-1' },
    { student_id: 's-2' },
    { student_id: 's-3' },
  ]);
  // s-3 never claimed an account; the query filters it out.
  prisma.student.findMany.mockResolvedValue([
    { user_profile_id: 'u-1' },
    { user_profile_id: 'u-2' },
  ]);
  prisma.course_notification.findMany.mockResolvedValue(
    (opts.already ?? []).map((id) => ({ user_profile_id: id })),
  );
  const pushes: { userIds: string[]; message: any }[] = [];
  const push = {
    sendToUsers: async (userIds: string[], message: any) => {
      pushes.push({ userIds, message });
    },
  };
  const service = new CourseNotificationService(prisma as any, push as any);
  return { prisma, service, pushes };
}

const rowsOf = (prisma: MockPrisma) =>
  prisma.course_notification.createMany.mock.calls[0]?.[0]?.data ?? [];

describe('CourseNotificationService events', () => {
  test('new work: a notice and a push per active student', async () => {
    const { prisma, service, pushes } = setup();
    await service.activityPublished('course-1', {
      id: 'act-1',
      title: 'Lab report',
      kind: 'assignment',
    });

    const enrolWhere = prisma.course_student.findMany.mock.calls[0][0].where;
    expect(enrolWhere).toEqual({ course_id: 'course-1', status: 'active' });

    const rows = rowsOf(prisma);
    expect(rows.map((r: any) => r.user_profile_id)).toEqual(['u-1', 'u-2']);
    expect(rows[0]).toMatchObject({
      course_id: 'course-1',
      kind: 'activity_published',
      activity_id: 'act-1',
      announcement_id: null,
      title: 'New work: Lab report',
    });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].userIds).toEqual(['u-1', 'u-2']);
    expect(pushes[0].message).toMatchObject({
      title: 'Biology 101: New work: Lab report',
      channelId: 'coursework',
      data: {
        type: 'course.activity_published',
        courseId: 'course-1',
        activityId: 'act-1',
      },
    });
  });

  test('reopened work only tells students who were not told before', async () => {
    const { prisma, service, pushes } = setup({ already: ['u-1'] });
    await service.activityPublished('course-1', {
      id: 'act-1',
      title: 'Quiz 1',
      kind: 'quiz',
    });
    expect(rowsOf(prisma).map((r: any) => r.user_profile_id)).toEqual(['u-2']);
    expect(pushes[0].userIds).toEqual(['u-2']);
  });

  test('a draft course tells nobody', async () => {
    const { prisma, service, pushes } = setup({ status: 'draft' });
    await service.activityPublished('course-1', {
      id: 'act-1',
      title: 'x',
      kind: 'assignment',
    });
    expect(prisma.course_notification.createMany).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(0);
  });

  test('announcement: body is a one-line preview', async () => {
    const { prisma, service, pushes } = setup();
    await service.announcementPosted('course-1', {
      id: 'ann-1',
      title: 'Field trip',
      body: `Bring\n\nboots. ${'x'.repeat(300)}`,
    });
    const [row] = rowsOf(prisma);
    expect(row).toMatchObject({
      kind: 'announcement',
      announcement_id: 'ann-1',
      activity_id: null,
      title: 'Field trip',
    });
    expect(row.body.startsWith('Bring boots.')).toBe(true);
    expect(row.body.length).toBe(140);
    expect(pushes[0].message.data).toEqual({
      type: 'course.announcement',
      courseId: 'course-1',
      announcementId: 'ann-1',
    });
  });

  test('never throws when the database fails', async () => {
    const { prisma, service, pushes } = setup();
    prisma.course_notification.createMany.mockRejectedValue(new Error('down'));
    await service.activityPublished('course-1', {
      id: 'act-1',
      title: 'x',
      kind: 'assignment',
    });
    expect(pushes).toHaveLength(0);
  });
});

describe('CourseNotificationService discussions', () => {
  test('a published topic tells the class once, not its author', async () => {
    const { prisma, service, pushes } = setup({ already: ['u-2'] });
    await service.discussionTopicPublished('course-1', {
      id: 't-1',
      title: 'Ask anything',
      body: 'Questions about week 1',
      authorUserProfileId: 'u-1',
    });
    // u-1 wrote it and u-2 was told before; nobody is left.
    expect(prisma.course_notification.createMany).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(0);

    const again = setup();
    await again.service.discussionTopicPublished('course-1', {
      id: 't-1',
      title: 'Ask anything',
      body: 'Questions about week 1',
      authorUserProfileId: 'staff-1',
    });
    const rows = rowsOf(again.prisma);
    expect(rows.map((r: any) => r.user_profile_id)).toEqual(['u-1', 'u-2']);
    expect(rows[0]).toMatchObject({
      kind: 'discussion_topic',
      discussion_topic_id: 't-1',
      title: 'New discussion: Ask anything',
      body: 'Questions about week 1',
    });
    expect(again.pushes[0].message.data).toEqual({
      type: 'course.discussion',
      courseId: 'course-1',
      topicId: 't-1',
    });
  });

  function replySetup(unread: string[] = []) {
    const ctx = setup();
    ctx.prisma.discussion_reply.findMany.mockResolvedValue([
      { author_user_profile_id: 'u-2' },
      { author_user_profile_id: 'staff-1' },
      { author_user_profile_id: 'u-9' }, // left the course
    ]);
    ctx.prisma.course_staff.findMany.mockResolvedValue([
      { user_profile_id: 'staff-1' },
    ]);
    ctx.prisma.user_profile.findUnique.mockResolvedValue({
      first_name: 'Sam',
      last_name: 'Lee',
    });
    ctx.prisma.course_notification.findMany.mockResolvedValue(
      unread.map((id) => ({ user_profile_id: id })),
    );
    return ctx;
  }

  test('a reply tells the author and posters, students in-app and staff by push', async () => {
    const { prisma, service, pushes } = replySetup();
    await service.discussionReplied(
      'course-1',
      { id: 't-1', title: 'Ask anything', authorUserProfileId: 'u-1' },
      { authorUserProfileId: 'u-2', body: 'I think   so' },
    );
    const rows = rowsOf(prisma);
    expect(rows.map((r: any) => r.user_profile_id)).toEqual(['u-1']);
    expect(rows[0]).toMatchObject({
      kind: 'discussion_reply',
      discussion_topic_id: 't-1',
      title: 'New reply: Ask anything',
      body: 'Sam Lee: I think so',
    });
    expect(pushes[0].userIds).toEqual(['u-1', 'staff-1']);
    expect(pushes[0].message.data).toEqual({
      type: 'course.discussion',
      courseId: 'course-1',
      topicId: 't-1',
    });
  });

  test('replies coalesce into the unread notice', async () => {
    const { prisma, service } = replySetup(['u-1']);
    await service.discussionReplied(
      'course-1',
      { id: 't-1', title: 'Ask anything', authorUserProfileId: 'u-1' },
      { authorUserProfileId: 'staff-1', body: 'Good question' },
    );
    const update = prisma.course_notification.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      user_profile_id: { in: ['u-1', 'u-2'] },
      discussion_topic_id: 't-1',
      kind: 'discussion_reply',
      read_at: null,
    });
    expect(update.data.body).toBe('Sam Lee: Good question');
    // u-1 already had one (refreshed above); only u-2 gets a new row.
    expect(rowsOf(prisma).map((r: any) => r.user_profile_id)).toEqual(['u-2']);
  });

  test('a reply never throws', async () => {
    const { prisma, service } = replySetup();
    prisma.discussion_reply.findMany.mockRejectedValue(new Error('down'));
    await service.discussionReplied(
      'course-1',
      { id: 't-1', title: 'x', authorUserProfileId: 'u-1' },
      { authorUserProfileId: 'u-2', body: 'y' },
    );
  });
});

describe('CourseNotificationService list', () => {
  test('shapes rows and scopes to the caller', async () => {
    const { prisma, service } = setup();
    prisma.course_notification.findMany.mockResolvedValue([
      {
        id: 'n-1',
        kind: 'announcement',
        course_id: 'course-1',
        activity_id: null,
        announcement_id: 'ann-1',
        discussion_topic_id: null,
        title: 'Field trip',
        body: null,
        read_at: null,
        created_at: new Date('2026-10-23T10:00:00Z'),
        course: { name: 'Biology 101' },
      },
    ]);
    const list = await service.list('u-1', { unread: true, limit: 500 });
    const args = prisma.course_notification.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ user_profile_id: 'u-1', read_at: null });
    expect(args.take).toBe(100);
    expect(list).toEqual([
      {
        id: 'n-1',
        kind: 'announcement',
        courseId: 'course-1',
        courseName: 'Biology 101',
        activityId: null,
        announcementId: 'ann-1',
        topicId: null,
        title: 'Field trip',
        body: null,
        readAt: null,
        createdAt: '2026-10-23T10:00:00.000Z',
      },
    ]);
  });

  test('mark read only touches the caller’s own notices', async () => {
    const { prisma, service } = setup();
    await service.markRead('u-1', ['n-1', 'n-2']);
    const args = prisma.course_notification.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      id: { in: ['n-1', 'n-2'] },
      user_profile_id: 'u-1',
      read_at: null,
    });
    expect(args.data.read_at).toBeInstanceOf(Date);
  });
});
