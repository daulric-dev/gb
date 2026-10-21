import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';

/**
 * What the caller is inside one course.
 *
 * `admin` is anyone holding `course:update` in the course's school - the
 * school admin by default - and can do everything a teacher can in every
 * course. `ta` reads everything and marks, but does not change settings,
 * people or delete things.
 */
export type CourseRole = 'admin' | 'teacher' | 'ta';

/** Roles that may change a course's structure, settings and roster. */
export const MANAGE_ROLES: readonly CourseRole[] = ['admin', 'teacher'];

/** Every staff role; reading and marking. */
export const STAFF_ROLES: readonly CourseRole[] = ['admin', 'teacher', 'ta'];

export const COURSE_COLUMNS =
  'id, school_id, academic_year_id, term_id, name, code, description, status, join_code, grade_scale_id, created_by, created_at, updated_at';

export interface CourseRow {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  term_id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  join_code: string | null;
  grade_scale_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The one place course access is decided.
 *
 * Every course-scoped service starts by calling `require` (staff) or
 * `requireStudent` (portal) and then works only with the course it returns.
 * A course the caller has no part in is reported as not found rather than
 * forbidden, so ids from another course or school reveal nothing.
 */
@Injectable()
export class CourseAccessService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async loadCourse(courseId: string): Promise<CourseRow> {
    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course')
      .select(COURSE_COLUMNS)
      .eq('id', courseId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Course not found');
    return data;
  }

  /** The caller's role in a course, or null when they have none. */
  async roleIn(userId: string, course: CourseRow): Promise<CourseRole | null> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: staff } = await supabase
      .schema('course')
      .from('course_staff')
      .select('role')
      .eq('course_id', course.id)
      .eq('user_profile_id', userId)
      .maybeSingle();

    const effective = await loadEffectivePermissions(
      this.supabaseService,
      this.cache,
      userId,
      course.school_id,
    );

    // Someone removed from the school keeps their course_staff rows until
    // they are cleaned up; membership is what actually grants access.
    if (!effective.member) return null;

    if (effective.keys.includes('course:update')) return 'admin';
    if (staff?.role === 'teacher' || staff?.role === 'ta') return staff.role;
    return null;
  }

  /**
   * Load a course for a staff caller and prove they hold one of `allowed`.
   *
   * No role at all is a 404; a role that is not enough (a TA trying to change
   * settings) is a 403, since they can already see the course exists.
   */
  async require(
    userId: string,
    courseId: string,
    allowed: readonly CourseRole[] = STAFF_ROLES,
  ): Promise<{ course: CourseRow; role: CourseRole }> {
    const course = await this.loadCourse(courseId);
    const role = await this.roleIn(userId, course);

    if (!role) throw new NotFoundException('Course not found');
    if (!allowed.includes(role)) {
      throw new ForbiddenException(
        'Only the course teacher can do that in this course',
      );
    }

    return { course, role };
  }

  /**
   * Load a course for a student. They must be actively enrolled, and the
   * course must be published: a draft is still being built and an archived
   * one is closed, though an archived course stays readable so past work and
   * grades remain visible.
   */
  async requireStudent(
    studentId: string,
    courseId: string,
    opts: { allowArchived?: boolean } = { allowArchived: true },
  ): Promise<CourseRow> {
    const course = await this.loadCourse(courseId);

    const visible =
      course.status === 'published' ||
      (opts.allowArchived && course.status === 'archived');
    if (!visible) throw new NotFoundException('Course not found');

    const { data: enrollment } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course_student')
      .select('status')
      .eq('course_id', courseId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (!enrollment || enrollment.status === 'dropped') {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  /** The course an activity belongs to, for routes keyed by activity id. */
  async courseIdOfActivity(activityId: string): Promise<string> {
    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .select('course_id')
      .eq('id', activityId)
      .maybeSingle();

    if (!data?.course_id) throw new NotFoundException('Activity not found');
    return data.course_id as string;
  }
}
