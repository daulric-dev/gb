import type { Collector } from '../data-export.types';
import { courseNames, inSchool, schoolNames, unique } from './helpers';

export const chatCollector: Collector = {
  id: 'chat',
  title: 'Chat',
  description:
    'Conversations the account is or was in (type, title, when joined and last read) and every message it sent, decrypted. Messages other people sent are their own data and are not included; ask the school if you need them.',
  covers: ['chat.message.sender_id', 'chat.conversation_member.user_id', 'chat.conversation.created_by'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const userId = ctx.subject.userId;
    if (!userId) return { data: { conversations: [], messages: [] }, count: 0 };
    const school = inSchool(ctx);
    const [members, created, messages] = await Promise.all([
      ctx.prisma.conversation_member.findMany({
        where: { user_id: userId, ...(ctx.subject.schoolId ? { conversation: { school_id: ctx.subject.schoolId } } : {}) },
        select: {
          conversation_id: true,
          role: true,
          created_at: true,
          last_read_at: true,
          conversation: { select: { type: true, title: true, created_at: true, created_by: true, school_id: true } },
        },
      }),
      ctx.prisma.conversation.findMany({
        where: { created_by: userId, ...school },
        select: { id: true },
      }),
      ctx.prisma.message.findMany({
        where: { sender_id: userId, ...school },
        select: {
          id: true,
          conversation_id: true,
          type: true,
          body: true,
          metadata: true,
          created_at: true,
          edited_at: true,
          deleted_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    const createdIds = new Set(created.map((c) => c.id));
    const schools = await schoolNames(ctx, members.map((m) => m.conversation.school_id));
    const data = {
      conversations: members.map((m) => ({
        id: m.conversation_id,
        school: schools.get(m.conversation.school_id) ?? null,
        type: m.conversation.type,
        title: m.conversation.title,
        startedByYou: createdIds.has(m.conversation_id) || m.conversation.created_by === userId,
        role: m.role,
        joinedAt: m.created_at,
        lastReadAt: m.last_read_at,
      })),
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        type: m.type,
        text: m.deleted_at ? null : ctx.cipher.decrypt(m.body),
        metadata: m.metadata,
        sentAt: m.created_at,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
      })),
    };
    return { data, count: data.conversations.length + data.messages.length };
  },
};

export const discussionsCollector: Collector = {
  id: 'discussions',
  title: 'Course discussions and announcements',
  description:
    'Discussion topics and replies the account wrote in course discussions, which topics it read and when, announcements it wrote, and announcements it marked as read.',
  covers: [
    'course.discussion_topic.author_user_profile_id',
    'course.discussion_reply.author_user_profile_id',
    'course.discussion_read.user_profile_id',
    'public.announcement.author_user_profile_id',
    'public.announcement_read.user_profile_id',
  ],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const userId = ctx.subject.userId;
    if (!userId) return { data: { topics: [], replies: [], reads: [], announcements: [], announcementsRead: [] }, count: 0 };
    const inCourse = ctx.subject.schoolId ? { course: { school_id: ctx.subject.schoolId } } : {};
    const [topics, replies, reads, announcements, announcementReads] = await Promise.all([
      ctx.prisma.discussion_topic.findMany({
        where: { author_user_profile_id: userId, ...inCourse },
        select: { id: true, course_id: true, title: true, body: true, created_at: true, edited_at: true },
      }),
      ctx.prisma.discussion_reply.findMany({
        where: { author_user_profile_id: userId, ...inCourse },
        select: { id: true, topic_id: true, course_id: true, parent_id: true, body: true, created_at: true, edited_at: true, deleted_at: true },
      }),
      ctx.prisma.discussion_read.findMany({
        where: { user_profile_id: userId, ...(ctx.subject.schoolId ? { discussion_topic: inCourse } : {}) },
        select: { topic_id: true, last_read_at: true },
      }),
      ctx.prisma.announcement.findMany({
        where: { author_user_profile_id: userId, ...inSchool(ctx) },
        select: { id: true, course_id: true, title: true, body: true, audience: true, created_at: true, updated_at: true },
      }),
      ctx.prisma.announcement_read.findMany({
        where: { user_profile_id: userId, ...(ctx.subject.schoolId ? { announcement: inSchool(ctx) } : {}) },
        select: { announcement_id: true, read_at: true },
      }),
    ]);
    const courses = await courseNames(
      ctx,
      unique([...topics.map((t) => t.course_id), ...replies.map((r) => r.course_id), ...announcements.map((a) => a.course_id)]),
    );
    const data = {
      topics: topics.map((t) => ({
        id: t.id,
        course: courses.get(t.course_id) ?? null,
        title: t.title,
        body: t.body,
        postedAt: t.created_at,
        editedAt: t.edited_at,
      })),
      replies: replies.map((r) => ({
        id: r.id,
        topicId: r.topic_id,
        inReplyTo: r.parent_id,
        course: courses.get(r.course_id) ?? null,
        body: r.deleted_at ? null : r.body,
        postedAt: r.created_at,
        editedAt: r.edited_at,
        deletedAt: r.deleted_at,
      })),
      reads: reads.map((r) => ({ topicId: r.topic_id, lastReadAt: r.last_read_at })),
      announcements: announcements.map((a) => ({
        id: a.id,
        course: a.course_id ? (courses.get(a.course_id) ?? null) : null,
        title: a.title,
        body: a.body,
        audience: a.audience,
        postedAt: a.created_at,
        updatedAt: a.updated_at,
      })),
      announcementsRead: announcementReads.map((r) => ({ announcementId: r.announcement_id, readAt: r.read_at })),
    };
    const count =
      data.topics.length + data.replies.length + data.reads.length + data.announcements.length + data.announcementsRead.length;
    return { data, count };
  },
};

export const notificationsCollector: Collector = {
  id: 'notifications',
  title: 'Notifications',
  description:
    'In-app notifications sent to the account (course activity, shared files), and for parent accounts their notice preferences and the notices sent to them.',
  covers: [
    'course.course_notification.user_profile_id',
    'file_manager.notification.user_id',
    'student.parent_notification_pref.user_profile_id',
    'student.parent_notification_sent.user_profile_id',
    'public.notification_preference.user_profile_id',
  ],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const userId = ctx.subject.userId;
    if (!userId) return { data: { course: [], files: [], parentPreferences: null, parentNoticesSent: [] }, count: 0 };
    const school = inSchool(ctx);
    const [course, files, pref, sent, notificationPreference] = await Promise.all([
      ctx.prisma.course_notification.findMany({
        where: { user_profile_id: userId, ...(ctx.subject.schoolId ? { course: school } : {}) },
        select: { course_id: true, kind: true, title: true, body: true, read_at: true, created_at: true },
        orderBy: { created_at: 'asc' },
      }),
      ctx.prisma.notification.findMany({
        where: { user_id: userId, ...school },
        select: { type: true, title: true, body: true, read_at: true, created_at: true },
        orderBy: { created_at: 'asc' },
      }),
      ctx.subject.schoolId
        ? null
        : ctx.prisma.parent_notification_pref.findUnique({
            where: { user_profile_id: userId },
            select: { email_enabled: true, push_enabled: true, kinds: true, updated_at: true },
          }),
      ctx.subject.schoolId
        ? []
        : ctx.prisma.parent_notification_sent.findMany({
            where: { user_profile_id: userId },
            select: { kind: true, sent_at: true },
            orderBy: { sent_at: 'asc' },
          }),
      ctx.subject.schoolId
        ? null
        : ctx.prisma.notification_preference.findUnique({
            where: { user_profile_id: userId },
            select: { push_off: true, email_off: true, updated_at: true },
          }),
    ]);
    const courses = await courseNames(ctx, course.map((c) => c.course_id));
    const data = {
      course: course.map((c) => ({
        course: courses.get(c.course_id) ?? null,
        kind: c.kind,
        title: c.title,
        body: c.body,
        sentAt: c.created_at,
        readAt: c.read_at,
      })),
      files: files.map((f) => ({ type: f.type, title: f.title, body: f.body, sentAt: f.created_at, readAt: f.read_at })),
      parentPreferences: pref
        ? { email: pref.email_enabled, push: pref.push_enabled, kinds: pref.kinds, updatedAt: pref.updated_at }
        : null,
      parentNoticesSent: sent.map((s) => ({ kind: s.kind, sentAt: s.sent_at })),
      preferences: notificationPreference
        ? { pushOff: notificationPreference.push_off, emailOff: notificationPreference.email_off, updatedAt: notificationPreference.updated_at }
        : null,
    };
    return { data, count: data.course.length + data.files.length + (pref ? 1 : 0) + data.parentNoticesSent.length + (notificationPreference ? 1 : 0) };
  },
};
