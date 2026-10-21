import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';

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
  courses: { total: number; draft: number; published: number; archived: number };
  students: { total: number; active: number };
  staff: { total: number; admins: number; teachers: number; members: number };
  recentActivity: RecentActivityEntry[];
}

const RECENT_LIMIT = 10;

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
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async summary(userId: string) {
    const db = this.supabase.getServiceClient();

    // School-wide numbers are a staff view; students have the portal.
    const { data: profile } = await db
      .from('user_profile')
      .select('account_type')
      .eq('id', userId)
      .maybeSingle();
    if (profile?.account_type === 'student') {
      throw new ForbiddenException('Staff only');
    }

    const schoolId = await this.supabase.getUserSchoolId(userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const effective = await loadEffectivePermissions(
      this.supabase,
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
    const { data: years } = await this.supabase
      .getServiceClient()
      .from('academic_year')
      .select('id, name, start_date, end_date')
      .eq('school_id', schoolId)
      .order('start_date', { ascending: false });

    const today = new Date().toISOString().slice(0, 10);
    const list = (years ?? []) as {
      id: string;
      name: string;
      start_date: string;
      end_date: string;
    }[];
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
    const db = this.supabase.getServiceClient();

    const { data: staffRows } = await db
      .schema('course')
      .from('course_staff')
      .select('course_id, role')
      .eq('user_profile_id', userId);

    const roles = new Map<string, 'teacher' | 'ta'>(
      (staffRows ?? []).map((r: any) => [r.course_id as string, r.role]),
    );
    if (roles.size === 0) return [];

    const { data: courses, error } = await db
      .schema('course')
      .from('course')
      .select('id, name, code, status, created_at')
      .eq('school_id', schoolId)
      .in('id', [...roles.keys()])
      .neq('status', 'archived')
      .order('name', { ascending: true });

    if (error) {
      this.logger.error(`Dashboard courses failed: ${error.message}`);
      throw new BadRequestException('Failed to load dashboard summary');
    }

    const list = (courses ?? []) as CourseLite[];
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

    const { data } = await this.supabase
      .getServiceClient()
      .schema('course')
      .from('course_student')
      .select('course_id')
      .in('course_id', courseIds)
      .eq('status', 'active');

    for (const row of data ?? []) {
      const id = (row as any).course_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /** Handed-in submissions per course that nobody has marked yet. */
  private async awaitingMarking(courseIds: string[]) {
    const counts = new Map<string, number>();
    if (courseIds.length === 0) return counts;
    const db = this.supabase.getServiceClient();

    const { data: activities } = await db
      .schema('grading')
      .from('activity')
      .select('id, course_id')
      .in('course_id', courseIds);

    const courseOf = new Map<string, string>(
      (activities ?? []).map((a: any) => [a.id, a.course_id]),
    );
    if (courseOf.size === 0) return counts;

    const { data: submissions } = await db
      .schema('grading')
      .from('submission')
      .select('activity_id')
      .in('activity_id', [...courseOf.keys()])
      .eq('status', 'submitted');

    for (const s of submissions ?? []) {
      const courseId = courseOf.get((s as any).activity_id as string);
      if (courseId) counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
    }
    return counts;
  }

  private async schoolOverview(schoolId: string): Promise<SchoolOverview> {
    const db = this.supabase.getServiceClient();

    const [{ data: courses }, { data: students }, { data: memberships }] =
      await Promise.all([
        db
          .schema('course')
          .from('course')
          .select('id, name, code, status, created_at')
          .eq('school_id', schoolId),
        db
          .schema('student')
          .from('student')
          .select('id, is_active')
          .eq('school_id', schoolId),
        db
          .from('school_management')
          .select('id, role')
          .eq('school_id', schoolId),
      ]);

    const courseList = (courses ?? []) as CourseLite[];
    const byStatus = (s: CourseLite['status']) =>
      courseList.filter((c) => c.status === s).length;
    const staff = (memberships ?? []) as { role: string }[];
    const studentList = (students ?? []) as { is_active: boolean | null }[];

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
    const db = this.supabase.getServiceClient();
    const nameOf = new Map(courses.map((c) => [c.id, c.name]));
    const courseIds = courses.map((c) => c.id);

    const [{ data: published }, { data: announcements }] = await Promise.all([
      courseIds.length
        ? db
            .schema('grading')
            .from('activity')
            .select('id, title, course_id, published_at')
            .in('course_id', courseIds)
            .not('published_at', 'is', null)
            .order('published_at', { ascending: false })
            .limit(RECENT_LIMIT)
        : Promise.resolve({ data: [] as any[] }),
      db
        .from('announcement')
        .select('id, title, course_id, created_at')
        .eq('school_id', schoolId)
        .not('course_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
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
      ...((published ?? [])).map((a) => ({
        type: 'activity_published' as const,
        id: a.id as string,
        title: a.title as string,
        courseId: a.course_id as string,
        courseName: nameOf.get(a.course_id as string) ?? null,
        at: a.published_at as string,
      })),
      ...((announcements ?? []) as any[]).map((a) => ({
        type: 'announcement' as const,
        id: a.id as string,
        title: a.title as string,
        courseId: a.course_id as string | null,
        courseName: a.course_id ? (nameOf.get(a.course_id as string) ?? null) : null,
        at: a.created_at as string,
      })),
    ];

    return entries
      .filter((e) => !!e.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, RECENT_LIMIT);
  }
}
