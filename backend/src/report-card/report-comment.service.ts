import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CourseAccessService,
  type CourseRow,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { ReportDataService, type TermContext, type TermCourse, dateOnly } from './report-data.service';
import { courseTermMode } from './report-card.calc';
import type { SaveReportCommentsDto } from './dto/report-card.dto';

/** The term a course's comment table opens on: today's, else the latest started, else the first. */
export function defaultTerm(terms: TermContext[], now = new Date()): TermContext | null {
  if (terms.length === 0) return null;
  const t = now.getTime();
  const current = terms.find(
    (term) =>
      (!term.start_date || term.start_date.getTime() <= t) &&
      (!term.end_date || term.end_date.getTime() + 86_400_000 > t),
  );
  if (current) return current;
  const started = terms.filter((term) => term.start_date && term.start_date.getTime() <= t);
  return started[started.length - 1] ?? terms[0];
}

/**
 * Teachers' report comments, one per student per course per term. Reading
 * takes any staff role in the course; writing takes a teacher of the course
 * (or a course admin: anyone holding `course:update`). TAs read only.
 */
@Injectable()
export class ReportCommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly data: ReportDataService,
  ) {}

  /** The terms a course reports in: its own term, or every term of its year. */
  async courseTerms(course: CourseRow): Promise<TermContext[]> {
    if (course.term_id) {
      const term = await this.data.term(course.school_id, course.term_id).catch(() => null);
      return term ? [term] : [];
    }
    if (!course.academic_year_id) return [];
    const all = await this.data.terms(course.school_id);
    return all.filter((t) => t.academic_year_id === course.academic_year_id);
  }

  private async resolveTerm(course: CourseRow, termId?: string) {
    const terms = await this.courseTerms(course);
    const term = termId ? terms.find((t) => t.id === termId) : defaultTerm(terms);
    if (termId && !term) throw new NotFoundException('This course has no report for that term');
    return { terms, term: term ?? null };
  }

  private termCourse(course: CourseRow, term: TermContext): TermCourse {
    return {
      id: course.id,
      name: course.name,
      code: course.code,
      school_id: course.school_id,
      term_id: course.term_id,
      academic_year_id: course.academic_year_id,
      grade_scale_id: course.grade_scale_id,
      mode: courseTermMode(course, term) ?? 'term',
      teachers: [],
    };
  }

  /** The comments table for one course and term. */
  async list(userId: string, courseId: string, termId?: string) {
    const { course, role } = await this.access.require(userId, courseId, STAFF_ROLES);
    const { terms, term } = await this.resolveTerm(course, termId);
    const termsOut = terms.map((t) => ({ id: t.id, name: t.name, yearName: t.yearName }));

    if (!term) {
      return {
        course: { id: course.id, name: course.name, code: course.code },
        terms: termsOut,
        term: null,
        deadline: null,
        publishedAt: null,
        canEdit: false,
        students: [],
      };
    }

    const enrolled = (await this.data.enrolments([course.id])).get(course.id) ?? [];
    const [students, grades, comments, release] = await Promise.all([
      this.data.students(course.school_id, enrolled),
      this.data.courseGrades(this.termCourse(course, term), term, enrolled),
      this.prisma.report_comment.findMany({
        where: { term_id: term.id, course_id: course.id },
        select: { student_id: true, body: true, status: true, updated_at: true },
      }),
      this.prisma.report_release.findUnique({
        where: { school_id_term_id: { school_id: course.school_id, term_id: term.id } },
        select: { comment_deadline: true, published_at: true },
      }),
    ]);
    const commentOf = new Map(comments.map((c) => [c.student_id, c]));

    return {
      course: { id: course.id, name: course.name, code: course.code },
      terms: termsOut,
      term: {
        id: term.id,
        name: term.name,
        yearName: term.yearName,
        startDate: dateOnly(term.start_date),
        endDate: dateOnly(term.end_date),
      },
      deadline: release?.comment_deadline?.toISOString() ?? null,
      publishedAt: release?.published_at?.toISOString() ?? null,
      canEdit: MANAGE_ROLES.includes(role) && !release?.published_at,
      students: students.map((s) => {
        const c = commentOf.get(s.id);
        const g = grades.get(s.id);
        return {
          studentId: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          percent: g?.percent ?? null,
          letter: g?.letter ?? null,
          comment: c?.body ?? '',
          status: c?.status ?? null,
          updatedAt: c?.updated_at?.toISOString() ?? null,
        };
      }),
    };
  }

  /**
   * Save several students' comments at once (the table's "Save"). Refused
   * while the term's reports are published: an admin unpublishes first, so
   * a published PDF never disagrees with what is on screen.
   */
  async save(userId: string, courseId: string, dto: SaveReportCommentsDto) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const { term } = await this.resolveTerm(course, dto.termId);
    if (!term) throw new NotFoundException('This course has no report for that term');

    const release = await this.prisma.report_release.findUnique({
      where: { school_id_term_id: { school_id: course.school_id, term_id: term.id } },
      select: { published_at: true },
    });
    if (release?.published_at) {
      throw new ConflictException(
        "This term's reports are published. Ask an admin to unpublish them before changing comments.",
      );
    }

    const seen = new Set<string>();
    for (const c of dto.comments) {
      if (seen.has(c.studentId)) throw new BadRequestException('Each student can appear only once');
      seen.add(c.studentId);
      if (c.status === 'ready' && !c.body.trim()) {
        throw new BadRequestException('Write a comment before marking it ready');
      }
    }

    const enrolled = new Set((await this.data.enrolments([course.id])).get(course.id) ?? []);
    const strangers = dto.comments.filter((c) => !enrolled.has(c.studentId));
    if (strangers.length) {
      throw new BadRequestException('Some students are not enrolled in this course');
    }

    const now = new Date();
    await this.prisma.$transaction(
      dto.comments.map((c) =>
        this.prisma.report_comment.upsert({
          where: {
            term_id_course_id_student_id: { term_id: term.id, course_id: course.id, student_id: c.studentId },
          },
          create: {
            term_id: term.id,
            course_id: course.id,
            student_id: c.studentId,
            author_id: userId,
            body: c.body.trim(),
            status: c.status,
          },
          update: { body: c.body.trim(), status: c.status, author_id: userId, updated_at: now },
        }),
      ),
    );

    return this.list(userId, courseId, term.id);
  }
}
