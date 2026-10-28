import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { dateOnly } from '@/common/db-values';
import {
  CourseAccessService,
  type CourseRow,
} from '@/course/access/course-access.service';
import { CourseService } from '@/course/course.service';
import { ModuleService } from '@/course/module.service';
import { PageService } from '@/course/page.service';
import { AnnouncementService } from '@/announcement/announcement.service';
import { GradebookService } from '@/grading/gradebook.service';
import { FileManagerService } from '@/file-manager/file-manager.service';
import type { StudentContext } from './student.guard';

/** Course states a student can open: published, or archived for the record. */
const VISIBLE_COURSE_STATUSES = ['published', 'archived'] as const;

/** What a portal course card is drawn from. */
type CardCourse = Pick<
  CourseRow,
  'id' | 'name' | 'code' | 'description' | 'status' | 'term_id'
>;

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
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly courses: CourseService,
    private readonly modules: ModuleService,
    private readonly pages: PageService,
    private readonly announcements: AnnouncementService,
    private readonly gradebook: GradebookService,
    private readonly files: FileManagerService,
  ) {}

  /** The student's own record and school. */
  async getMe(ctx: StudentContext) {
    let student;
    let failure: string | undefined;
    try {
      student = await this.prisma.student.findUnique({
        where: { id: ctx.studentId },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          date_of_birth: true,
          gender: true,
          enrollment_date: true,
        },
      });
    } catch (error) {
      failure = (error as Error).message;
    }

    if (!student) {
      this.logger.error(
        `Failed to load student ${ctx.studentId}: ${failure}`,
      );
      throw new NotFoundException('Student record not found');
    }

    const school = await this.prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { id: true, name: true, school_type: true },
    });

    return {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      dateOfBirth: dateOnly(student.date_of_birth as Date),
      gender: student.gender,
      enrollmentDate: dateOnly(student.enrollment_date as Date),
      school: school
        ? { id: school.id, name: school.name, type: school.school_type }
        : null,
    };
  }

  // ── courses ───────────────────────────────────────────────────────────────

  /** Every course the student is (or was, if completed) enrolled in. */
  async listCourses(ctx: StudentContext) {
    let enrollments;
    try {
      enrollments = await this.prisma.course_student.findMany({
        where: { student_id: ctx.studentId, status: { not: 'dropped' } },
        select: { course_id: true, status: true },
      });
    } catch (error) {
      this.logger.error(
        `Failed to load courses for student ${ctx.studentId}: ${(error as Error).message}`,
      );
      throw new NotFoundException('Could not load your courses');
    }

    const courseIds = enrollments.map((e) => e.course_id);
    if (courseIds.length === 0) return [];

    const courses = await this.prisma.course.findMany({
      where: {
        id: { in: courseIds },
        status: { in: [...VISIBLE_COURSE_STATUSES] },
        is_template: false,
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        status: true,
        term_id: true,
      },
      orderBy: { name: 'asc' },
    });

    return this.toCards(ctx, courses);
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

  /**
   * A file a student reaches through their course: linked from a published
   * item in a published module, or shared with the whole course. Students hold
   * no `file` permission, so the file manager's own routes turn them away.
   * A file the course does not offer answers 404, never 403.
   */
  async getCourseFile(ctx: StudentContext, courseId: string, fileId: string) {
    await this.access.requireStudent(ctx.studentId, courseId);

    const [linked, shared] = await Promise.all([
      this.prisma.module_item.findFirst({
        where: {
          course_id: courseId,
          file_id: fileId,
          is_published: true,
          module: { is_published: true },
          file: { deleted_at: null },
        },
        select: { id: true },
      }),
      this.prisma.file_share.findFirst({
        where: {
          file_id: fileId,
          principal_type: 'course',
          principal_id: courseId,
          file: { deleted_at: null },
        },
        select: { id: true },
      }),
    ]);
    if (!linked && !shared) throw new NotFoundException('File not found');

    return this.files.readContentForAuthorisedCaller(fileId);
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
  private async toCards(ctx: StudentContext, courses: CardCourse[]) {
    if (courses.length === 0) return [];
    const ids = courses.map((c) => c.id);

    const staff = await this.prisma.course_staff.findMany({
      where: { course_id: { in: ids }, role: 'teacher' },
      select: { course_id: true, user_profile_id: true },
    });

    const profileIds = [...new Set(staff.map((s) => s.user_profile_id))];
    const profiles = profileIds.length
      ? await this.prisma.user_profile.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const teachersOf = new Map<
      string,
      { firstName: string | null; lastName: string | null }[]
    >();
    for (const s of staff) {
      const p = profileById.get(s.user_profile_id);
      if (!p) continue;
      const list = teachersOf.get(s.course_id) ?? [];
      list.push({ firstName: p.first_name ?? null, lastName: p.last_name ?? null });
      teachersOf.set(s.course_id, list);
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
