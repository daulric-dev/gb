import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isoDate } from '@/common/db-values';
import { PushService } from '@/notifications/push.service';

export type CourseNotificationKind =
  | 'activity_published'
  | 'announcement'
  | 'discussion_topic'
  | 'discussion_reply';

/** What the portal bell and the mobile inbox show for one notice. */
export interface CourseNotification {
  id: string;
  kind: CourseNotificationKind;
  courseId: string;
  courseName: string | null;
  activityId: string | null;
  announcementId: string | null;
  topicId: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

const NOTIFICATION_SELECT = {
  id: true,
  kind: true,
  course_id: true,
  activity_id: true,
  announcement_id: true,
  discussion_topic_id: true,
  title: true,
  body: true,
  read_at: true,
  created_at: true,
  course: { select: { name: true } },
} as const;

const MAX_PAGE = 100;
const BODY_PREVIEW = 140;

/** Whitespace-collapsed text cut to a notification-sized preview. */
function preview(text: string | null | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > BODY_PREVIEW
    ? `${flat.slice(0, BODY_PREVIEW - 1)}…`
    : flat;
}

/** Android channel the mobile app creates for course news. */
export const COURSE_CHANNEL = 'coursework';

/**
 * Tells a course's students about new work, announcements and discussions.
 *
 * Each event writes one in-app notice per active student (what the portal
 * bell lists) and sends an Expo push to their devices. Both are best effort:
 * callers fire and forget, nothing here throws back into the request that
 * published the work, and failures are only logged.
 */
@Injectable()
export class CourseNotificationService {
  private readonly logger = new Logger(CourseNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** An activity was published (or reopened). Never throws. */
  async activityPublished(
    courseId: string,
    activity: { id: string; title: string; kind: string },
  ): Promise<void> {
    await this.notify(courseId, {
      kind: 'activity_published',
      activity_id: activity.id,
      title: `New ${activity.kind === 'quiz' ? 'quiz' : 'work'}: ${activity.title}`,
      body: null,
      data: {
        type: 'course.activity_published',
        courseId,
        activityId: activity.id,
      },
    });
  }

  /** A course announcement was posted. Never throws. */
  async announcementPosted(
    courseId: string,
    announcement: { id: string; title: string; body: string | null },
  ): Promise<void> {
    await this.notify(courseId, {
      kind: 'announcement',
      announcement_id: announcement.id,
      title: announcement.title,
      body: preview(announcement.body),
      data: {
        type: 'course.announcement',
        courseId,
        announcementId: announcement.id,
      },
    });
  }

  /**
   * A discussion topic went up (created published, or published later).
   * Each student hears about a topic once; its author is not told about
   * their own topic. Never throws.
   */
  async discussionTopicPublished(
    courseId: string,
    topic: {
      id: string;
      title: string;
      body: string | null;
      authorUserProfileId: string | null;
    },
  ): Promise<void> {
    await this.notify(courseId, {
      kind: 'discussion_topic',
      discussion_topic_id: topic.id,
      title: `New discussion: ${topic.title}`,
      body: preview(topic.body),
      exclude: topic.authorUserProfileId,
      data: { type: 'course.discussion', courseId, topicId: topic.id },
    });
  }

  /**
   * Someone replied in a topic. Its author and everyone who has posted in it
   * (bar the replier) are told. Students actively enrolled get an in-app
   * notice - at most one unread per topic, refreshed by each new reply - and
   * a push; the course's staff, who have no in-app list, get the push only.
   * Never throws.
   */
  async discussionReplied(
    courseId: string,
    topic: { id: string; title: string; authorUserProfileId: string | null },
    reply: { authorUserProfileId: string; body: string },
  ): Promise<void> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, name: true, status: true },
      });
      if (course?.status !== 'published') return;

      const posters = await this.prisma.discussion_reply.findMany({
        where: { topic_id: topic.id, author_user_profile_id: { not: null } },
        select: { author_user_profile_id: true },
        distinct: ['author_user_profile_id'],
      });
      const involved = new Set<string>(
        posters
          .map((p) => p.author_user_profile_id)
          .filter((id): id is string => !!id),
      );
      if (topic.authorUserProfileId) involved.add(topic.authorUserProfileId);
      involved.delete(reply.authorUserProfileId);
      if (involved.size === 0) return;

      const [students, staff, replier] = await Promise.all([
        this.recipients(course.id),
        this.prisma.course_staff.findMany({
          where: { course_id: course.id },
          select: { user_profile_id: true },
        }),
        this.prisma.user_profile.findUnique({
          where: { id: reply.authorUserProfileId },
          select: { first_name: true, last_name: true },
        }),
      ]);
      const studentIds = students.filter((id) => involved.has(id));
      const staffIds = staff
        .map((s) => s.user_profile_id)
        .filter((id) => involved.has(id) && !studentIds.includes(id));
      if (studentIds.length === 0 && staffIds.length === 0) return;

      const who =
        [replier?.first_name, replier?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Someone';
      const title = `New reply: ${topic.title}`;
      const body = preview(`${who}: ${reply.body}`);

      if (studentIds.length > 0) {
        const unread = {
          user_profile_id: { in: studentIds },
          discussion_topic_id: topic.id,
          kind: 'discussion_reply',
          read_at: null,
        };
        const now = new Date();
        await this.prisma.course_notification.updateMany({
          where: unread,
          data: { title, body, created_at: now },
        });
        const existing = await this.prisma.course_notification.findMany({
          where: unread,
          select: { user_profile_id: true },
        });
        const have = new Set(existing.map((e) => e.user_profile_id));
        const fresh = studentIds.filter((id) => !have.has(id));
        if (fresh.length > 0) {
          // The partial unique index keeps a racing reply from doubling up.
          await this.prisma.course_notification.createMany({
            data: fresh.map((user_profile_id) => ({
              user_profile_id,
              course_id: course.id,
              kind: 'discussion_reply',
              discussion_topic_id: topic.id,
              title,
              body,
              created_at: now,
            })),
            skipDuplicates: true,
          });
        }
      }

      await this.push.sendToUsers([...studentIds, ...staffIds], {
        title: `${course.name}: ${title}`,
        body: body ?? 'Tap to open',
        data: { type: 'course.discussion', courseId, topicId: topic.id },
        channelId: COURSE_CHANNEL,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify about a reply in ${topic.id}: ${(err as Error).message}`,
      );
    }
  }

  private async notify(
    courseId: string,
    notice: {
      kind: CourseNotificationKind;
      activity_id?: string;
      announcement_id?: string;
      discussion_topic_id?: string;
      title: string;
      body: string | null;
      /** An account not to tell (whoever caused the event). */
      exclude?: string | null;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, name: true, status: true },
      });
      // Students cannot see a draft or archived course; nothing to tell them.
      if (course?.status !== 'published') return;

      const userIds = (await this.recipients(course.id)).filter(
        (id) => id !== notice.exclude,
      );
      if (userIds.length === 0) return;

      // Reopened work (or a republished topic) is skipped by the unique
      // (user, activity) and (user, topic) keys, so a student is told once;
      // only the newly written rows get a push.
      const existing = notice.activity_id
        ? await this.prisma.course_notification.findMany({
            where: {
              activity_id: notice.activity_id,
              user_profile_id: { in: userIds },
            },
            select: { user_profile_id: true },
          })
        : notice.discussion_topic_id
          ? await this.prisma.course_notification.findMany({
              where: {
                kind: notice.kind,
                discussion_topic_id: notice.discussion_topic_id,
                user_profile_id: { in: userIds },
              },
              select: { user_profile_id: true },
            })
          : [];
      const already = new Set(existing.map((e) => e.user_profile_id));
      const fresh = userIds.filter((id) => !already.has(id));
      if (fresh.length === 0) return;

      await this.prisma.course_notification.createMany({
        data: fresh.map((user_profile_id) => ({
          user_profile_id,
          course_id: course.id,
          kind: notice.kind,
          activity_id: notice.activity_id ?? null,
          announcement_id: notice.announcement_id ?? null,
          discussion_topic_id: notice.discussion_topic_id ?? null,
          title: notice.title,
          body: notice.body,
        })),
        skipDuplicates: true,
      });

      // The push names the course; the in-app list shows it beside the title.
      await this.push.sendToUsers(fresh, {
        title: `${course.name}: ${notice.title}`,
        body: notice.body ?? 'Tap to open',
        data: notice.data,
        channelId: COURSE_CHANNEL,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify course ${courseId}: ${(err as Error).message}`,
      );
    }
  }

  /** Accounts of the course's active, signed-up students. */
  private async recipients(courseId: string): Promise<string[]> {
    const enrolments = await this.prisma.course_student.findMany({
      where: { course_id: courseId, status: 'active' },
      select: { student_id: true },
    });
    if (enrolments.length === 0) return [];

    const students = await this.prisma.student.findMany({
      where: {
        id: { in: enrolments.map((e) => e.student_id) },
        is_active: { not: false },
        user_profile_id: { not: null },
      },
      select: { user_profile_id: true },
    });
    return [
      ...new Set(
        students
          .map((s) => s.user_profile_id)
          .filter((id): id is string => !!id),
      ),
    ];
  }

  // ── the recipient's own list ──────────────────────────────────────────────

  /** Newest first; `before` pages back by `createdAt`. */
  async list(
    userId: string,
    opts: { limit?: number; before?: string; unread?: boolean } = {},
  ): Promise<CourseNotification[]> {
    const take = Math.min(Math.max(opts.limit ?? 30, 1), MAX_PAGE);
    try {
      const rows = await this.prisma.course_notification.findMany({
        where: {
          user_profile_id: userId,
          ...(opts.unread ? { read_at: null } : {}),
          ...(opts.before ? { created_at: { lt: new Date(opts.before) } } : {}),
        },
        select: NOTIFICATION_SELECT,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as CourseNotificationKind,
        courseId: r.course_id,
        courseName: r.course?.name ?? null,
        activityId: r.activity_id,
        announcementId: r.announcement_id,
        topicId: r.discussion_topic_id,
        title: r.title,
        body: r.body,
        readAt: isoDate(r.read_at),
        createdAt: isoDate(r.created_at)!,
      }));
    } catch (err) {
      this.logger.error(
        `Failed to list notifications: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to load notifications');
    }
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.course_notification.count({
      where: { user_profile_id: userId, read_at: null },
    });
    return { count };
  }

  /** Only ever the caller's own notices; anyone else's id is a no-op. */
  async markRead(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.course_notification.updateMany({
      where: { id: { in: ids }, user_profile_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.course_notification.updateMany({
      where: { user_profile_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
  }
}
