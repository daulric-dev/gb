import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isoDate } from '@/common/db-values';
import { PushService } from '@/notifications/push.service';

export type CourseNotificationKind = 'activity_published' | 'announcement';

/** What the portal bell and the mobile inbox show for one notice. */
export interface CourseNotification {
  id: string;
  kind: CourseNotificationKind;
  courseId: string;
  courseName: string | null;
  activityId: string | null;
  announcementId: string | null;
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
  title: true,
  body: true,
  read_at: true,
  created_at: true,
  course: { select: { name: true } },
} as const;

const MAX_PAGE = 100;
const BODY_PREVIEW = 140;

/** Android channel the mobile app creates for course news. */
export const COURSE_CHANNEL = 'coursework';

/**
 * Tells a course's students about new work and announcements.
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
    const preview = (announcement.body ?? '').replace(/\s+/g, ' ').trim();
    await this.notify(courseId, {
      kind: 'announcement',
      announcement_id: announcement.id,
      title: announcement.title,
      body:
        preview.length > BODY_PREVIEW
          ? `${preview.slice(0, BODY_PREVIEW - 1)}…`
          : preview || null,
      data: {
        type: 'course.announcement',
        courseId,
        announcementId: announcement.id,
      },
    });
  }

  private async notify(
    courseId: string,
    notice: {
      kind: CourseNotificationKind;
      activity_id?: string;
      announcement_id?: string;
      title: string;
      body: string | null;
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

      const userIds = await this.recipients(course.id);
      if (userIds.length === 0) return;

      // Reopened work is skipped by the unique (user, activity) key, so a
      // student is told once; only the newly written rows get a push.
      const existing = notice.activity_id
        ? await this.prisma.course_notification.findMany({
            where: {
              activity_id: notice.activity_id,
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
