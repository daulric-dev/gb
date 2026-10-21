import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CacheService } from '@/cache/cache.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { dateOnly, isoDate } from '@/common/db-values';

interface CourseLite {
  id: string;
  name: string;
  code: string | null;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
}

export interface DashboardCourse {
  id: string;
  name: string;
  code: string | null;
  status: CourseLite['status'];
  role: 'admin' | 'teacher' | 'ta';
  studentCount: number;
  /** Submissions handed in and not yet marked. */
  awaitingMarking: number;
}

export interface RecentActivityEntry {
  type: 'course_created' | 'activity_published' | 'announcement';
  id: string;
  title: string;
  courseId: string | null;
  courseName: string | null;
  at: string;
}

export interface SchoolOverview {
  courses: {
    total: number;
    draft: number;
    published: number;
    archived: number;
  };
  students: { total: number; active: number };
  staff: { total: number; admins: number; teachers: number; members: number };
  recentActivity: RecentActivityEntry[];
}

const RECENT_LIMIT = 10;

const COURSE_LITE_SELECT = {
  id: true,
  name: true,
  code: true,
  status: true,
  created_at: true,
} as const;

function toCourseLite(c: {
  id: string;
  name: string;
  code: string | null;
  status: CourseLite['status'];
  created_at: Date;
}): CourseLite {
  return { ...c, created_at: isoDate(c.created_at)! };
}

/**
 * The staff home screen.
 *
 * Computed here from the course tables rather than by the old
 * `dashboard-summary` edge function, which counted classes, class
 * enrolments and class attendance - none of which exist any more.
 *
 * Everyone gets the courses they teach or assist in, with what is waiting to
 * be marked. Whoever can manage every course in the school (`course:update`,
 * the admin by default) also gets school-wide counts and a feed of recent
 * course activity.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  async summary(userId: string) {
    // School-wide numbers are a staff view; students have the portal.
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true },
    });
    if (profile?.account_type === 'student') {
      throw new ForbiddenException('Staff only');
    }

    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const effective = await loadEffectivePermissions(
      this.prisma,
      this.cache,
      userId,
      schoolId,
    );
    const isAdmin = effective.keys.includes('course:update');

    const [activeYear, myCourses, school] = await Promise.all([
      this.activeYear(schoolId),
      this.myCourses(userId, schoolId),
      isAdmin ? this.schoolOverview(schoolId) : Promise.resolve(null),
    ]);

    return {
      schoolId,
      isAdmin,
      activeYear,
      myCourses,
      awaitingMarking: myCourses.reduce((n, c) => n + c.awaitingMarking, 0),
      school,
    };
  }

  /** The year covering today, else the most recent one. */
  private async activeYear(schoolId: string) {
    const years = await this.prisma.academic_year.findMany({
      where: { school_id: schoolId },
      select: { id: true, name: true, start_date: true, end_date: true },
      orderBy: { start_date: 'desc' },
    });

    const today = new Date().toISOString().slice(0, 10);
    const list = years.map((y) => ({
      id: y.id,
      name: y.name as string,
      start_date: dateOnly(y.start_date) as string,
      end_date: dateOnly(y.end_date) as string,
    }));
    const year =
      list.find((y) => y.start_date <= today && y.end_date >= today) ??
      list[0] ??
      null;
    return year
      ? {
          id: year.id,
          name: year.name,
          startDate: year.start_date,
          endDate: year.end_date,
        }
      : null;
  }

  /** Courses the caller is on as teacher or TA, archived ones left out. */
  private async myCourses(
    userId: string,
    schoolId: string,
  ): Promise<DashboardCourse[]> {
    const staffRows = await this.prisma.course_staff.findMany({
      where: { user_profile_id: userId },
      select: { course_id: true, role: true },
    });

    const roles = new Map<string, 'teacher' | 'ta'>(
      staffRows.map((r) => [r.course_id, r.role]),
    );
    if (roles.size === 0) return [];

    let list: CourseLite[];
    try {
      const courses = await this.prisma.course.findMany({
        where: {
          school_id: schoolId,
          id: { in: [...roles.keys()] },
          status: { not: 'archived' },
        },
        select: COURSE_LITE_SELECT,
        orderBy: { name: 'asc' },
      });
      list = courses.map(toCourseLite);
    } catch (error) {
      this.logger.error(
        `Dashboard courses failed: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to load dashboard summary');
    }

    const ids = list.map((c) => c.id);
    const [students, awaiting] = await Promise.all([
      this.studentCounts(ids),
      this.awaitingMarking(ids),
    ]);

    return list.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      status: c.status,
      role: roles.get(c.id)!,
      studentCount: students.get(c.id) ?? 0,
      awaitingMarking: awaiting.get(c.id) ?? 0,
    }));
  }

  private async studentCounts(courseIds: string[]) {
    const counts = new Map<string, number>();
    if (courseIds.length === 0) return counts;

    const rows = await this.prisma.course_student.groupBy({
      by: ['course_id'],
      where: { course_id: { in: courseIds }, status: 'active' },
      _count: { _all: true },
    });

    for (const row of rows) counts.set(row.course_id, row._count._all);
    return counts;
  }

  /** Handed-in submissions per course that nobody has marked yet. */
  private async awaitingMarking(courseIds: string[]) {
    const counts = new Map<string, number>();
    if (courseIds.length === 0) return counts;
    const submissions = await this.prisma.submission.findMany({
      where: {
        status: 'submitted',
        activity: { course_id: { in: courseIds } },
      },
      select: { activity: { select: { course_id: true } } },
    });

    for (const s of submissions) {
      const courseId = s.activity.course_id;
      if (courseId) counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
    }
    return counts;
  }

  private async schoolOverview(schoolId: string): Promise<SchoolOverview> {
    const [courses, studentList, staff] = await Promise.all([
      this.prisma.course.findMany({
        where: { school_id: schoolId },
        select: COURSE_LITE_SELECT,
      }),
      this.prisma.student.findMany({
        where: { school_id: schoolId },
        select: { id: true, is_active: true },
      }),
      this.prisma.school_management.findMany({
        where: { school_id: schoolId },
        select: { id: true, role: true },
      }),
    ]);

    const courseList = courses.map(toCourseLite);
    const byStatus = (s: CourseLite['status']) =>
      courseList.filter((c) => c.status === s).length;

    return {
      courses: {
        total: courseList.length,
        draft: byStatus('draft'),
        published: byStatus('published'),
        archived: byStatus('archived'),
      },
      students: {
        total: studentList.length,
        active: studentList.filter((s) => s.is_active !== false).length,
      },
      staff: {
        total: staff.length,
        admins: staff.filter((m) => m.role === 'admin').length,
        teachers: staff.filter((m) => m.role === 'teacher').length,
        members: staff.filter((m) => m.role === 'member').length,
      },
      recentActivity: await this.recentActivity(schoolId, courseList),
    };
  }

  /**
   * The latest happenings across the school's courses: new courses,
   * newly published work and course announcements, newest first.
   */
  private async recentActivity(
    schoolId: string,
    courses: CourseLite[],
  ): Promise<RecentActivityEntry[]> {
    const nameOf = new Map(courses.map((c) => [c.id, c.name]));
    const courseIds = courses.map((c) => c.id);

    const [published, announcements] = await Promise.all([
      courseIds.length
        ? this.prisma.activity.findMany({
            where: {
              course_id: { in: courseIds },
              published_at: { not: null },
            },
            select: {
              id: true,
              title: true,
              course_id: true,
              published_at: true,
            },
            orderBy: { published_at: 'desc' },
            take: RECENT_LIMIT,
          })
        : Promise.resolve([]),
      this.prisma.announcement.findMany({
        where: { school_id: schoolId, course_id: { not: null } },
        select: { id: true, title: true, course_id: true, created_at: true },
        // Postgres sorts nulls first when descending, as PostgREST did.
        orderBy: { created_at: { sort: 'desc', nulls: 'first' } },
        take: RECENT_LIMIT,
      }),
    ]);

    const entries: RecentActivityEntry[] = [
      ...courses.map((c) => ({
        type: 'course_created' as const,
        id: c.id,
        title: c.name,
        courseId: c.id,
        courseName: c.name,
        at: c.created_at,
      })),
      ...published.map((a) => ({
        type: 'activity_published' as const,
        id: a.id,
        title: a.title,
        courseId: a.course_id as string,
        courseName: nameOf.get(a.course_id as string) ?? null,
        at: isoDate(a.published_at) as string,
      })),
      ...announcements.map((a) => ({
        type: 'announcement' as const,
        id: a.id,
        title: a.title,
        courseId: a.course_id,
        courseName: a.course_id ? (nameOf.get(a.course_id) ?? null) : null,
        at: isoDate(a.created_at) as string,
      })),
    ];

    return entries
      .filter((e) => !!e.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, RECENT_LIMIT);
  }
}
