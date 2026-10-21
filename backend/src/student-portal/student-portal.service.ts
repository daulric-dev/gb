import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import {
  COURSE_COLUMNS,
  CourseAccessService,
  type CourseRow,
} from '@/course/access/course-access.service';
import { CourseService } from '@/course/course.service';
import { ModuleService } from '@/course/module.service';
import { PageService } from '@/course/page.service';
import { AnnouncementService } from '@/announcement/announcement.service';
import { GradebookService } from '@/grading/gradebook.service';
import type { StudentContext } from './student.guard';

/** Course states a student can open: published, or archived for the record. */
const VISIBLE_COURSE_STATUSES = ['published', 'archived'] as const;

/**
 * Read-only, self-scoped views of a student's own record and courses.
 *
 * Every method takes the StudentContext the guard resolved and works from
 * `ctx.studentId`. No method accepts a student id from the caller, so there
 * is no parameter to tamper with. Course routes go through
 * `CourseAccessService.requireStudent`, which 404s for any course the
 * student is not actively enrolled in or that is still a draft.
 *
 * A course's join code is never returned here: it is the teacher's to hand
 * out, and a student who has it already used it.
 */
@Injectable()
export class StudentPortalService {
  private readonly logger = new Logger(StudentPortalService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly access: CourseAccessService,
    private readonly courses: CourseService,
    private readonly modules: ModuleService,
    private readonly pages: PageService,
    private readonly announcements: AnnouncementService,
    private readonly gradebook: GradebookService,
  ) {}

  /** The student's own record and school. */
  async getMe(ctx: StudentContext) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: student, error } = await supabase
      .schema('student')
      .from('student')
      .select(
        'id, first_name, last_name, date_of_birth, gender, enrollment_date',
      )
      .eq('id', ctx.studentId)
      .maybeSingle();

    if (error || !student) {
      this.logger.error(
        `Failed to load student ${ctx.studentId}: ${error?.message}`,
      );
      throw new NotFoundException('Student record not found');
    }

    const { data: school } = await supabase
      .from('school')
      .select('id, name, school_type')
      .eq('id', ctx.schoolId)
      .maybeSingle();

    return {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      dateOfBirth: student.date_of_birth,
      gender: student.gender,
      enrollmentDate: student.enrollment_date,
      school: school
        ? { id: school.id, name: school.name, type: school.school_type }
        : null,
    };
  }

  // ── courses ───────────────────────────────────────────────────────────────

  /** Every course the student is (or was, if completed) enrolled in. */
  async listCourses(ctx: StudentContext) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: enrollments, error } = await supabase
      .schema('course')
      .from('course_student')
      .select('course_id, status')
      .eq('student_id', ctx.studentId)
      .neq('status', 'dropped');

    if (error) {
      this.logger.error(
        `Failed to load courses for student ${ctx.studentId}: ${error.message}`,
      );
      throw new NotFoundException('Could not load your courses');
    }

    const courseIds = (enrollments ?? []).map((e: any) => e.course_id as string);
    if (courseIds.length === 0) return [];

    const { data: courses } = await supabase
      .schema('course')
      .from('course')
      .select(COURSE_COLUMNS)
      .in('id', courseIds)
      .in('status', [...VISIBLE_COURSE_STATUSES])
      .order('name', { ascending: true });

    return this.toCards(ctx, (courses ?? []));
  }

  async getCourse(ctx: StudentContext, courseId: string) {
    const course = await this.access.requireStudent(ctx.studentId, courseId);
    const [card] = await this.toCards(ctx, [course]);
    return card;
  }

  /** Enrol by the code a teacher handed out; returns the new course card. */
  async joinCourse(ctx: StudentContext, joinCode: string) {
    const course = await this.courses.joinByCode(
      ctx.studentId,
      ctx.schoolId,
      joinCode,
    );
    return this.getCourse(ctx, course.id);
  }

  async getModules(ctx: StudentContext, courseId: string) {
    await this.access.requireStudent(ctx.studentId, courseId);
    return this.modules.listForStudent(courseId);
  }

  async getPage(ctx: StudentContext, courseId: string, pageId: string) {
    await this.access.requireStudent(ctx.studentId, courseId);
    return this.pages.getPublished(courseId, pageId);
  }

  async getAnnouncements(ctx: StudentContext, courseId: string) {
    await this.access.requireStudent(ctx.studentId, courseId);
    return this.announcements.findForStudent(courseId);
  }

  /**
   * Shape courses as portal cards: teachers by name and the student's own
   * running grade. A grade that fails to compute leaves the card without one
   * rather than failing the whole list.
   */
  private async toCards(ctx: StudentContext, courses: CourseRow[]) {
    if (courses.length === 0) return [];
    const supabase = this.supabaseService.getServiceClient();
    const ids = courses.map((c) => c.id);

    const { data: staff } = await supabase
      .schema('course')
      .from('course_staff')
      .select('course_id, user_profile_id')
      .in('course_id', ids)
      .eq('role', 'teacher');

    const profileIds = [
      ...new Set((staff ?? []).map((s: any) => s.user_profile_id as string)),
    ];
    const { data: profiles } = profileIds.length
      ? await supabase
          .from('user_profile')
          .select('id, first_name, last_name')
          .in('id', profileIds)
      : { data: [] as any[] };
    const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const teachersOf = new Map<
      string,
      { firstName: string | null; lastName: string | null }[]
    >();
    for (const s of (staff ?? []) as any[]) {
      const p = profileById.get(s.user_profile_id);
      if (!p) continue;
      const list = teachersOf.get(s.course_id as string) ?? [];
      list.push({ firstName: p.first_name ?? null, lastName: p.last_name ?? null });
      teachersOf.set(s.course_id as string, list);
    }

    const grades = await Promise.all(
      courses.map((c) =>
        this.gradebook.studentSummary(c.id, ctx.studentId).catch((err) => {
          this.logger.warn(
            `Grade unavailable for course ${c.id}: ${(err as Error).message}`,
          );
          return null;
        }),
      ),
    );

    return courses.map((c, i) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      description: c.description,
      status: c.status,
      termId: c.term_id,
      teachers: teachersOf.get(c.id) ?? [],
      grade: grades[i] ?? null,
    }));
  }
}
