import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isoDate, isNotFound } from '@/common/db-values';
import { CacheService } from '@/cache/cache.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { CourseNotificationService } from '@/course-notification/course-notification.service';

const AUTHOR_SELECT = {
  select: { first_name: true, last_name: true, avatar_url: true },
} as const;

const CONTENT_SELECT = {
  id: true,
  school_id: true,
  course_id: true,
  author_user_profile_id: true,
  title: true,
  body: true,
  created_at: true,
  updated_at: true,
  user_profile: AUTHOR_SELECT,
} as const;

interface ContentDbRow {
  id: string;
  school_id: string;
  course_id: string | null;
  author_user_profile_id: string | null;
  title: string;
  body: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  user_profile: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}

/** The row as the API has always sent it, author embedded as `author`. */
const toContent = (r: ContentDbRow) => ({
  id: r.id,
  school_id: r.school_id,
  course_id: r.course_id,
  author_user_profile_id: r.author_user_profile_id,
  title: r.title,
  body: r.body,
  created_at: isoDate(r.created_at),
  updated_at: isoDate(r.updated_at),
  author: r.user_profile,
});
type Content = ReturnType<typeof toContent>;
const CONTENT_TTL = 60 * 60 * 24 * 30;
const contentKey = (schoolId: string) => `announcements:content:${schoolId}`;

/**
 * What a student sees of a course announcement: no read receipts (other
 * students' names) and no internal author id.
 */
const STUDENT_SELECT = {
  id: true,
  course_id: true,
  title: true,
  body: true,
  created_at: true,
  updated_at: true,
  user_profile: AUTHOR_SELECT,
} as const;

export interface ReaderRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly courseAccess: CourseAccessService,
    @Optional() private readonly notices?: CourseNotificationService,
  ) {}

  /** Resolve the caller's school + role in one lookup. */
  private async getProfile(userId: string) {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true, role: true },
    });

    if (!profile?.school_id) {
      this.logger.error(`Failed to resolve school for user ${userId}`);
      throw new BadRequestException('Could not determine your school');
    }
    return { school_id: profile.school_id, role: profile.role };
  }

  /** Merge live read receipts into cached announcement content. */
  private async attachReaders<
    T extends { id: string; author_user_profile_id: string | null },
  >(items: T[]): Promise<(T & { readers: ReaderRow[] })[]> {
    if (items.length === 0) return [];

    const reads = await this.prisma.announcement_read.findMany({
      where: { announcement_id: { in: items.map((i) => i.id) } },
      select: {
        announcement_id: true,
        user_profile: {
          select: { id: true, first_name: true, last_name: true, avatar_url: true },
        },
      },
    });

    const byAnnouncement = new Map<string, ReaderRow[]>();
    for (const r of reads) {
      const reader: ReaderRow | null = r.user_profile;
      const announcement_id = r.announcement_id;

      if (!reader) continue;

      const list = byAnnouncement.get(announcement_id) ?? [];

      list.push(reader);
      byAnnouncement.set(announcement_id, list);
    }

    return items.map((item) => ({
      ...item,
      // The author isn't shown as a "reader" of their own post.
      readers: (byAnnouncement.get(item.id) ?? []).filter(
        (rd) => rd.id !== item.author_user_profile_id,
      ),
    }));
  }

  async findAll(userId: string) {
    const { school_id }: { school_id: string } = await this.getProfile(userId);

    let content = (await this.cache.get(contentKey(school_id))) as
      | Content[]
      | null;
    if (!content) {
      try {
        const rows = await this.prisma.announcement.findMany({
          // Course announcements belong to their course's stream only.
          where: { school_id, course_id: null },
          orderBy: { created_at: { sort: 'desc', nulls: 'first' } },
          select: CONTENT_SELECT,
        });
        content = rows.map(toContent);
      } catch (err) {
        this.logger.error(
          `Failed to fetch announcements: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to fetch announcements');
      }
      await this.cache.set(contentKey(school_id), content, CONTENT_TTL);
    }

    return this.attachReaders(content);
  }

  async findOne(userId: string, id: string) {
    const { school_id } = await this.getProfile(userId);

    const data = await this.prisma.announcement
      .findFirst({
        where: { id, school_id, course_id: null },
        select: CONTENT_SELECT,
      })
      .catch(() => null);

    if (!data) throw new NotFoundException('Announcement not found');
    return (await this.attachReaders([toContent(data)]))[0];
  }

  async create(userId: string, dto: CreateAnnouncementDto) {
    const { school_id }: { school_id: string } = await this.getProfile(userId);

    let data: Content;
    try {
      data = toContent(
        await this.prisma.announcement.create({
          data: {
            school_id,
            author_user_profile_id: userId,
            title: dto.title,
            body: dto.body ?? null,
          },
          select: CONTENT_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to create announcement: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to create announcement');
    }
    await this.cache.delete(contentKey(school_id));
    return { ...data, readers: [] as ReaderRow[] };
  }

  async update(userId: string, id: string, dto: UpdateAnnouncementDto) {
    const { school_id }: { school_id: string } = await this.assertCanManage(
      userId,
      id,
    );

    let data: Content;
    try {
      data = toContent(
        await this.prisma.announcement.update({
          where: { id },
          data: {
            updated_at: new Date(),
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.body !== undefined ? { body: dto.body } : {}),
          },
          select: CONTENT_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to update announcement: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update announcement');
    }
    await this.cache.delete(contentKey(school_id));
    return (await this.attachReaders([data]))[0];
  }

  async delete(userId: string, id: string) {
    const { school_id }: { school_id: string } = await this.assertCanManage(
      userId,
      id,
    );

    try {
      await this.prisma.announcement.delete({ where: { id } });
    } catch (err) {
      // Already gone (a concurrent delete) was never an error.
      if (!isNotFound(err)) {
        this.logger.error(
          `Failed to delete announcement: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to delete announcement');
      }
    }
    await this.cache.delete(contentKey(school_id));
    return { message: 'Announcement deleted' };
  }

  /**
   * Number of school-wide announcements posted by others the user hasn't
   * read.
   *
   * This used to call the `announcement_unread_count` RPC, but that function
   * predates course announcements and counts every announcement in the
   * school, so a teacher would see a badge for posts in courses they are not
   * on. Until the RPC gains a `course_id IS NULL` filter in a migration, the
   * count is done here.
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const { school_id } = await this.getProfile(userId);

    const anns = await this.prisma.announcement.findMany({
      where: { school_id, course_id: null },
      select: { id: true, author_user_profile_id: true },
    });

    const candidates = anns
      .filter((a) => a.author_user_profile_id !== userId)
      .map((a) => a.id);
    if (candidates.length === 0) return { count: 0 };

    const reads = await this.prisma.announcement_read.findMany({
      where: { user_profile_id: userId, announcement_id: { in: candidates } },
      select: { announcement_id: true },
    });

    const read = new Set(reads.map((r) => r.announcement_id));
    return { count: candidates.filter((id) => !read.has(id)).length };
  }

  /** Record a read receipt for every announcement currently in the school. */
  async markRead(userId: string): Promise<{ count: number }> {
    const { school_id } = await this.getProfile(userId);

    const anns = await this.prisma.announcement.findMany({
      where: { school_id, course_id: null },
      select: { id: true },
    });

    const rows = anns.map((a) => ({
      announcement_id: a.id,
      user_profile_id: userId,
    }));

    if (rows.length > 0) {
      try {
        await this.prisma.announcement_read.createMany({
          data: rows,
          skipDuplicates: true,
        });
      } catch (err) {
        this.logger.error(`Failed to mark read: ${(err as Error).message}`);
        throw new BadRequestException('Failed to mark announcements read');
      }
    }
    return { count: 0 };
  }

  // ── course announcements ──────────────────────────────────────────────────

  /** A course's announcements, newest first, for any of its staff. */
  async findForCourse(userId: string, courseId: string) {
    await this.courseAccess.require(userId, courseId, STAFF_ROLES);

    let data: Content[];
    try {
      const rows = await this.prisma.announcement.findMany({
        where: { course_id: courseId },
        orderBy: { created_at: { sort: 'desc', nulls: 'first' } },
        select: CONTENT_SELECT,
      });
      data = rows.map(toContent);
    } catch (err) {
      this.logger.error(
        `Failed to fetch course announcements: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to fetch announcements');
    }
    return this.attachReaders(data);
  }

  /** TAs post too: announcing is part of running the course day to day. */
  async createForCourse(
    userId: string,
    courseId: string,
    dto: CreateAnnouncementDto,
  ) {
    const { course } = await this.courseAccess.require(
      userId,
      courseId,
      STAFF_ROLES,
    );

    let data: Content;
    try {
      data = toContent(
        await this.prisma.announcement.create({
          data: {
            school_id: course.school_id,
            course_id: course.id,
            author_user_profile_id: userId,
            title: dto.title,
            body: dto.body ?? null,
          },
          select: CONTENT_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to create course announcement: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to create announcement');
    }

    // Fire and forget: posting never waits on notices or pushes.
    void this.notices?.announcementPosted(course.id, data);
    return { ...data, readers: [] as ReaderRow[] };
  }

  /**
   * Edit a course announcement. Its author may, and so may the course's
   * teachers and admins: a teacher must be able to correct or pull a TA's post.
   */
  async updateForCourse(
    userId: string,
    courseId: string,
    id: string,
    dto: UpdateAnnouncementDto,
  ) {
    await this.assertCanManageInCourse(userId, courseId, id);

    let data: Content;
    try {
      data = toContent(
        await this.prisma.announcement.update({
          where: { id },
          data: {
            updated_at: new Date(),
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.body !== undefined ? { body: dto.body } : {}),
          },
          select: CONTENT_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to update course announcement: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update announcement');
    }
    return (await this.attachReaders([data]))[0];
  }

  async deleteForCourse(userId: string, courseId: string, id: string) {
    await this.assertCanManageInCourse(userId, courseId, id);

    try {
      await this.prisma.announcement.delete({ where: { id } });
    } catch (err) {
      if (!isNotFound(err)) {
        this.logger.error(
          `Failed to delete course announcement: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to delete announcement');
      }
    }
    return { message: 'Announcement deleted' };
  }

  /**
   * A course's announcements for a student. The caller (portal) has already
   * proved the student is enrolled in a visible course.
   */
  async findForStudent(courseId: string) {
    try {
      const rows = await this.prisma.announcement.findMany({
        where: { course_id: courseId },
        orderBy: { created_at: { sort: 'desc', nulls: 'first' } },
        select: STUDENT_SELECT,
      });
      return rows.map((r) => ({
        id: r.id,
        course_id: r.course_id,
        title: r.title,
        body: r.body,
        created_at: isoDate(r.created_at),
        updated_at: isoDate(r.updated_at),
        author: r.user_profile,
      }));
    } catch (err) {
      this.logger.error(
        `Failed to fetch course announcements: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to fetch announcements');
    }
  }

  /**
   * Editing/removing a school-wide notice is limited to its author or a
   * school admin. Course announcements go through the course routes instead.
   * Returns the caller's school_id for cache invalidation.
   */
  private async assertCanManage(userId: string, id: string) {
    const profile = await this.getProfile(userId);

    // A malformed id is just a missing announcement.
    const existing = await this.prisma.announcement
      .findFirst({
        where: { id, school_id: profile.school_id, course_id: null },
        select: { author_user_profile_id: true },
      })
      .catch(() => null);

    if (!existing) throw new NotFoundException('Announcement not found');

    const isAuthor = existing.author_user_profile_id === userId;
    if (profile.role !== 'admin' && !isAuthor) {
      throw new ForbiddenException(
        'You can only edit announcements you posted',
      );
    }
    return profile;
  }

  /** Any course staff member reaches the post; only its author or a manager changes it. */
  private async assertCanManageInCourse(
    userId: string,
    courseId: string,
    id: string,
  ) {
    const { role } = await this.courseAccess.require(
      userId,
      courseId,
      STAFF_ROLES,
    );

    const existing = await this.prisma.announcement
      .findFirst({
        where: { id, course_id: courseId },
        select: { author_user_profile_id: true },
      })
      .catch(() => null);
    if (!existing) throw new NotFoundException('Announcement not found');

    const isAuthor = existing.author_user_profile_id === userId;
    if (!isAuthor && !MANAGE_ROLES.includes(role)) {
      throw new ForbiddenException(
        'Only the author or a course teacher can change this announcement',
      );
    }
  }
}
