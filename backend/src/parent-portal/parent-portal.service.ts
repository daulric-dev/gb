import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { optionalImageUrl } from '@/images/public-url';
import { GradebookService } from '@/grading/gradebook.service';
import { SubmissionService } from '@/grading/submission.service';
import { AnnouncementService } from '@/announcement/announcement.service';
import { tally } from '@/attendance/attendance.service';
import { excludedByAge, parseParentSettings, type ParentSettings } from './parent-settings';
import { toParentGrades, toParentWork } from './parent-portal.mapper';

/** One entry of GET /parent/children/:studentId/announcements. */
export interface ParentAnnouncement {
  id: string;
  /** `school`: the school's post for everyone; `course`: a course post. */
  scope: 'school' | 'course';
  courseId: string | null;
  courseName: string | null;
  schoolName: string | null;
  title: string;
  body: string | null;
  createdAt: string | null;
  author: { firstName: string | null; lastName: string | null } | null;
}

/** The child a request is about, as ParentGuard resolved it. */
export interface ChildContext {
  studentId: string;
  schoolId: string;
}

export const PARENT_VIEW_HIDDEN = 'PARENT_VIEW_HIDDEN';

const VISIBLE_COURSE_STATUSES = ['published', 'archived'] as const;

/** Most attendance sessions returned per course. */
const MAX_SESSIONS = 200;

function hidden(what: string) {
  return new ForbiddenException({
    statusCode: 403,
    code: PARENT_VIEW_HIDDEN,
    message: `Your child's school does not show ${what} to parents`,
  });
}

/**
 * Read-only views of a linked child for the parent portal. Every method
 * takes the child ParentGuard checked. Responses are built field by field
 * from the student-portal data (never spread), so nothing beyond what the
 * student sees - and nothing staff-only (attendance locations and flags,
 * lockdown away data, accommodations, submissions, answers, feedback) - can
 * reach a parent. The school's parent settings are enforced here.
 */
@Injectable()
export class ParentPortalService {
  private readonly logger = new Logger(ParentPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly gradebook: GradebookService,
    private readonly submissions: SubmissionService,
    private readonly announcements: AnnouncementService,
  ) {}

  async settingsFor(schoolId: string): Promise<ParentSettings> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { parent_settings: true },
    });
    return parseParentSettings(school?.parent_settings);
  }

  /** What the apps need to draw a child's tabs. */
  private async visibility(schoolId: string, settings: ParentSettings) {
    const f = await this.features.effective(schoolId);
    return {
      grades: settings.showGrades,
      work: settings.showWork,
      attendance: settings.showAttendance && f.attendance,
      announcements: settings.showAnnouncements && f.announcements,
      reports: settings.showReports && f.report_cards,
      notifications: f.parent_notifications,
    };
  }

  /**
   * The caller's linked children whose school has the parent portal on and
   * does not leave them out by age.
   */
  async children(userId: string) {
    const links = await this.prisma.parent_student_link.findMany({
      where: { user_profile_id: userId },
      orderBy: { created_at: 'asc' },
      select: {
        relationship: true,
        relationship_label: true,
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            is_active: true,
            date_of_birth: true,
            school_id: true,
            school: {
              select: {
                id: true,
                name: true,
                logo_path: true,
                is_active: true,
                parent_settings: true,
              },
            },
          },
        },
      },
    });

    const out: Array<Record<string, unknown>> = [];
    for (const l of links) {
      const s = l.student;
      if (!s?.school || s.is_active === false || s.school.is_active === false) continue;
      if (!(await this.features.isEnabled(s.school.id, 'parent_portal'))) continue;
      const settings = parseParentSettings(s.school.parent_settings);
      if (excludedByAge(settings, s.date_of_birth)) continue;
      out.push({
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        relationship: l.relationship,
        relationshipLabel: l.relationship_label,
        school: {
          id: s.school.id,
          name: s.school.name,
          logoUrl: optionalImageUrl(s.school.logo_path),
        },
        visibility: await this.visibility(s.school.id, settings),
      });
    }
    return out;
  }

  private async enrolledCourses(studentId: string) {
    const enrolments = await this.prisma.course_student.findMany({
      where: { student_id: studentId, status: { not: 'dropped' } },
      select: { course_id: true },
    });
    const ids = enrolments.map((e) => e.course_id);
    if (ids.length === 0) return [];
    return this.prisma.course.findMany({
      where: {
        id: { in: ids },
        status: { in: [...VISIBLE_COURSE_STATUSES] },
        is_template: false,
      },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Header for a child's pages: name, school, what the school shows. */
  async overview(ctx: ChildContext) {
    const [student, school, settings] = await Promise.all([
      this.prisma.student.findUnique({
        where: { id: ctx.studentId },
        select: { id: true, first_name: true, last_name: true },
      }),
      this.prisma.school.findUnique({
        where: { id: ctx.schoolId },
        select: { id: true, name: true, logo_path: true },
      }),
      this.settingsFor(ctx.schoolId),
    ]);
    if (!student) throw new NotFoundException('Child not found');
    const visibility = await this.visibility(ctx.schoolId, settings);

    const [courses, work] = await Promise.all([
      this.courses(ctx, settings),
      settings.showWork ? this.work(ctx, settings) : Promise.resolve(null),
    ]);

    return {
      child: { id: student.id, firstName: student.first_name, lastName: student.last_name },
      school: school
        ? { id: school.id, name: school.name, logoUrl: optionalImageUrl(school.logo_path) }
        : null,
      visibility,
      courses,
      upcomingCount: work?.upcoming.length ?? null,
      missingCount: work?.missing.length ?? null,
    };
  }

  /** Course list; each with the current grade when the school shows grades. */
  async courses(ctx: ChildContext, known?: ParentSettings) {
    const settings = known ?? (await this.settingsFor(ctx.schoolId));
    const courses = await this.enrolledCourses(ctx.studentId);
    if (courses.length === 0) return [];

    const staff = await this.prisma.course_staff.findMany({
      where: { course_id: { in: courses.map((c) => c.id) }, role: 'teacher' },
      select: {
        course_id: true,
        user_profile: { select: { first_name: true, last_name: true } },
      },
    });

    const grades = settings.showGrades
      ? await Promise.all(
          courses.map((c) =>
            this.gradebook.studentSummary(c.id, ctx.studentId).catch((err) => {
              this.logger.warn(`Grade unavailable for course ${c.id}: ${(err as Error).message}`);
              return null;
            }),
          ),
        )
      : courses.map(() => null);

    return courses.map((c, i) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      status: c.status,
      teachers: staff
        .filter((s) => s.course_id === c.id && s.user_profile)
        .map((s) => ({
          firstName: s.user_profile.first_name ?? null,
          lastName: s.user_profile.last_name ?? null,
        })),
      grade: grades[i]
        ? { percent: grades[i].percent, letter: grades[i].letter }
        : null,
    }));
  }

  /** One course's grades: marked work only, as the student sees it. */
  async courseGrades(ctx: ChildContext, courseId: string) {
    const settings = await this.settingsFor(ctx.schoolId);
    if (!settings.showGrades) throw hidden('grades');
    // requireStudent inside: 404 unless the child is enrolled and it is visible.
    const data = await this.gradebook.studentGrades(ctx.studentId, courseId);
    return toParentGrades(data);
  }

  /** Upcoming and missing work across the child's courses. */
  async work(ctx: ChildContext, known?: ParentSettings) {
    const settings = known ?? (await this.settingsFor(ctx.schoolId));
    if (!settings.showWork) throw hidden('upcoming and missing work');
    const items = await this.submissions.listForStudent(ctx.studentId);
    return toParentWork(items, settings.showGrades);
  }

  /** Attendance per course: status and time only, never where. */
  async attendance(ctx: ChildContext) {
    const settings = await this.settingsFor(ctx.schoolId);
    if (!settings.showAttendance) throw hidden('attendance');
    const courses = await this.enrolledCourses(ctx.studentId);
    if (courses.length === 0) return { summary: tally([]), courses: [] };

    const records = await this.prisma.course_attendance_record.findMany({
      where: { student_id: ctx.studentId, course_id: { in: courses.map((c) => c.id) } },
      // Explicit: no latitude, longitude, accuracy, distance, flags or notes.
      select: {
        course_id: true,
        status: true,
        checked_in_at: true,
        attendance_session: { select: { id: true, title: true, opened_at: true } },
      },
      orderBy: { attendance_session: { opened_at: 'desc' } },
      take: MAX_SESSIONS * courses.length,
    });

    const byCourse = courses.map((c) => {
      const mine = records.filter((r) => r.course_id === c.id);
      return {
        courseId: c.id,
        courseName: c.name,
        summary: tally(mine),
        records: mine.slice(0, MAX_SESSIONS).map((r) => ({
          sessionId: r.attendance_session.id,
          title: r.attendance_session.title,
          openedAt: r.attendance_session.opened_at.toISOString(),
          status: r.status,
          checkedInAt: r.checked_in_at ? r.checked_in_at.toISOString() : null,
        })),
      };
    });
    return { summary: tally(records), courses: byCourse };
  }

  /**
   * Announcements for the child, newest first: the child's school's
   * announcements meant for everyone (`scope: 'school'`, never staff-only
   * notices) and the announcements of the child's courses (`scope: 'course'`).
   * The school is the child's, as ParentGuard resolved it.
   */
  async announcementsFor(ctx: ChildContext) {
    const settings = await this.settingsFor(ctx.schoolId);
    if (!settings.showAnnouncements) throw hidden('announcements');
    const person = (a: { first_name: string | null; last_name: string | null } | null | undefined) =>
      a ? { firstName: a.first_name ?? null, lastName: a.last_name ?? null } : null;
    const [courses, school, schoolRows] = await Promise.all([
      this.enrolledCourses(ctx.studentId),
      this.prisma.school.findUnique({ where: { id: ctx.schoolId }, select: { name: true } }),
      this.announcements.findEveryoneForSchool(ctx.schoolId),
    ]);
    const schoolItems = schoolRows.map((r): ParentAnnouncement => ({
      id: r.id,
      scope: 'school',
      courseId: null,
      courseName: null,
      schoolName: school?.name ?? null,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      author: person(r.author),
    }));
    const lists = await Promise.all(
      courses.map(async (c) => {
        const rows = await this.announcements.findForStudent(c.id);
        return rows.map((r): ParentAnnouncement => ({
          id: r.id,
          scope: 'course',
          courseId: c.id,
          courseName: c.name,
          schoolName: null,
          title: r.title,
          body: r.body,
          createdAt: r.created_at,
          author: person(r.author),
        }));
      }),
    );
    const time = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
    return [...schoolItems, ...lists.flat()].sort(
      (a, b) => time(b.createdAt) - time(a.createdAt),
    );
  }
}
