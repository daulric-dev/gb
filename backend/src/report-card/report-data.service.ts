import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { logoForPdf } from './report-logo';
import { StorageService } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import { scoreOrNull } from '@/grading/round';
import type { CalcBand, CalcGroup, CalcSubmission } from '@/grading/gradebook.calc';
import {
  type CourseTermMode,
  type FinalGrade,
  type TermGradeActivity,
  compareStudents,
  courseTermMode,
  finalCourseGrade,
  studentDisplayName,
  summariseAttendance,
  termCutoff,
  termStart,
} from './report-card.calc';
import {
  type ReportCardDocument,
  type ReportSchool,
  type TranscriptDocument,
  type TranscriptTerm,
} from './report-pdf';

/** Courses students actually see; drafts and templates never get reports. */
const REPORTABLE_STATUSES = ['published', 'archived'] as const;
/** Enrolments that get a report. */
const ENROLLED = ['active', 'completed'] as const;
/** A logo larger than this is left off the PDF. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export interface TermContext {
  id: string;
  name: string;
  academic_year_id: string | null;
  yearName: string | null;
  start_date: Date | null;
  end_date: Date | null;
  sort_order: number | null;
  schoolId: string;
}

export interface TermCourse {
  id: string;
  name: string;
  code: string | null;
  school_id: string;
  term_id: string | null;
  academic_year_id: string | null;
  grade_scale_id: string | null;
  mode: CourseTermMode;
  teachers: string[];
}

/** YYYY-MM-DD of a date column, or null. */
export function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Reads everything a report needs. Every query here is scoped by the school
 * and term the caller already proved access to; this service makes no
 * access decisions of its own.
 */
@Injectable()
export class ReportDataService {
  private readonly logger = new Logger(ReportDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** A term of the school, or 404 (also for another school's term). */
  async term(schoolId: string, termId: string): Promise<TermContext> {
    const term = await this.prisma.term.findFirst({
      where: { id: termId, academic_year: { school_id: schoolId } },
      select: {
        id: true,
        name: true,
        academic_year_id: true,
        start_date: true,
        end_date: true,
        sort_order: true,
        academic_year: { select: { name: true } },
      },
    });
    if (!term) throw new NotFoundException('Term not found');
    return {
      id: term.id,
      name: term.name ?? 'Term',
      academic_year_id: term.academic_year_id,
      yearName: term.academic_year?.name ?? null,
      start_date: term.start_date,
      end_date: term.end_date,
      sort_order: term.sort_order,
      schoolId,
    };
  }

  /** Every term of the school, oldest year first, then by sort order. */
  async terms(schoolId: string): Promise<TermContext[]> {
    const rows = await this.prisma.term.findMany({
      where: { academic_year: { school_id: schoolId } },
      select: {
        id: true,
        name: true,
        academic_year_id: true,
        start_date: true,
        end_date: true,
        sort_order: true,
        academic_year: { select: { name: true, start_date: true } },
      },
    });
    rows.sort(
      (a, b) =>
        (a.academic_year?.start_date?.getTime() ?? 0) - (b.academic_year?.start_date?.getTime() ?? 0) ||
        (a.academic_year?.name ?? '').localeCompare(b.academic_year?.name ?? '') ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.start_date?.getTime() ?? 0) - (b.start_date?.getTime() ?? 0),
    );
    return rows.map((t) => ({
      id: t.id,
      name: t.name ?? 'Term',
      academic_year_id: t.academic_year_id,
      yearName: t.academic_year?.name ?? null,
      start_date: t.start_date,
      end_date: t.end_date,
      sort_order: t.sort_order,
      schoolId,
    }));
  }

  /**
   * The school's courses on a term's report: courses set to the term, and
   * the year's courses with no term (see `courseTermMode`). Drafts and
   * templates are left out. Optionally only the given course ids.
   */
  async coursesForTerm(term: TermContext, onlyIds?: string[]): Promise<TermCourse[]> {
    const or: object[] = [{ term_id: term.id }];
    if (term.academic_year_id) {
      or.push({ term_id: null, academic_year_id: term.academic_year_id });
    }
    const courses = await this.prisma.course.findMany({
      where: {
        school_id: term.schoolId,
        is_template: false,
        status: { in: [...REPORTABLE_STATUSES] },
        OR: or,
        ...(onlyIds ? { id: { in: onlyIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        school_id: true,
        term_id: true,
        academic_year_id: true,
        grade_scale_id: true,
      },
      orderBy: [{ name: 'asc' }],
    });
    const ids = courses.map((c) => c.id);
    const staff = ids.length
      ? await this.prisma.course_staff.findMany({
          where: { course_id: { in: ids }, role: 'teacher' },
          select: {
            course_id: true,
            user_profile: { select: { first_name: true, last_name: true } },
          },
        })
      : [];
    const teachers = new Map<string, string[]>();
    for (const s of staff) {
      const name = [s.user_profile?.first_name, s.user_profile?.last_name].filter(Boolean).join(' ').trim();
      if (!name) continue;
      teachers.set(s.course_id, [...(teachers.get(s.course_id) ?? []), name]);
    }
    return courses.flatMap((c) => {
      const mode = courseTermMode(c, term);
      return mode ? [{ ...c, mode, teachers: (teachers.get(c.id) ?? []).sort() }] : [];
    });
  }

  /** Enrolled (active or completed) students per course id. */
  async enrolments(courseIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (courseIds.length === 0) return out;
    const rows = await this.prisma.course_student.findMany({
      where: { course_id: { in: courseIds }, status: { in: [...ENROLLED] } },
      select: { course_id: true, student_id: true },
    });
    for (const r of rows) out.set(r.course_id, [...(out.get(r.course_id) ?? []), r.student_id]);
    return out;
  }

  /** Students of the school by id, sorted by last then first name. */
  async students(schoolId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.student.findMany({
      where: { id: { in: [...new Set(ids)] }, school_id: schoolId },
      select: { id: true, first_name: true, last_name: true },
    });
    return rows.sort(compareStudents);
  }

  /** Every student on the term's report (enrolled in one of its courses). */
  async studentIdsForTerm(term: TermContext): Promise<string[]> {
    const courses = await this.coursesForTerm(term);
    const enrolled = await this.enrolments(courses.map((c) => c.id));
    const ids = new Set<string>();
    for (const list of enrolled.values()) for (const id of list) ids.add(id);
    const students = await this.students(term.schoolId, [...ids]);
    return students.map((s) => s.id);
  }

  /** The course's scale, else the school's default (as the gradebook does). */
  private async bands(course: { grade_scale_id: string | null; school_id: string }): Promise<CalcBand[]> {
    let scaleId = course.grade_scale_id;
    if (!scaleId) {
      const scale = await this.prisma.grade_scale.findFirst({
        where: { school_id: course.school_id, is_default: true },
        select: { id: true },
      });
      scaleId = scale?.id ?? null;
    }
    if (!scaleId) return [];
    const bands = await this.prisma.grade_scale_band.findMany({
      where: { grade_scale_id: scaleId },
      select: { label: true, min_percentage: true, max_percentage: true },
    });
    return bands.map((b) => ({
      label: b.label,
      minPercentage: Number(b.min_percentage),
      maxPercentage: Number(b.max_percentage),
    }));
  }

  /**
   * Final grade and letter per student for one course in a term, computed
   * for every given student at once (one query per table, not per student).
   */
  async courseGrades(
    course: TermCourse,
    term: TermContext,
    studentIds: string[],
  ): Promise<Map<string, FinalGrade>> {
    const out = new Map<string, FinalGrade>();
    if (studentIds.length === 0) return out;

    const [groups, activities, bands] = await Promise.all([
      this.prisma.assignment_group.findMany({
        where: { course_id: course.id },
        select: { id: true, name: true, weight: true, position: true, drop_lowest: true, drop_highest: true },
      }),
      this.prisma.activity.findMany({
        where: { course_id: course.id, status: { in: ['published', 'closed'] } },
        select: {
          id: true,
          assignment_group_id: true,
          points: true,
          status: true,
          omit_from_final_grade: true,
          due_at: true,
          created_at: true,
        },
      }),
      this.bands(course),
    ]);

    const calcGroups: CalcGroup[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      weight: g.weight == null ? null : Number(g.weight),
      position: g.position,
      dropLowest: g.drop_lowest ?? 0,
      dropHighest: g.drop_highest ?? 0,
    }));
    const calcActivities: TermGradeActivity[] = activities.map((a) => ({
      id: a.id,
      assignmentGroupId: a.assignment_group_id ?? null,
      points: Number(a.points),
      status: a.status,
      omitFromFinalGrade: !!a.omit_from_final_grade,
      due_at: a.due_at,
      created_at: a.created_at,
    }));

    const submissions = activities.length
      ? await this.prisma.submission.findMany({
          where: { activity_id: { in: activities.map((a) => a.id) }, student_id: { in: studentIds } },
          select: { activity_id: true, student_id: true, status: true, score: true, excused: true },
        })
      : [];
    const byStudent = new Map<string, Map<string, CalcSubmission>>();
    for (const s of submissions) {
      const m = byStudent.get(s.student_id) ?? new Map<string, CalcSubmission>();
      m.set(s.activity_id, {
        status: (s.status ?? null),
        score: scoreOrNull(s.score),
        excused: !!s.excused,
      });
      byStudent.set(s.student_id, m);
    }

    const cutoff = termCutoff(term.end_date);
    for (const id of studentIds) {
      out.set(
        id,
        finalCourseGrade(calcGroups, calcActivities, byStudent.get(id) ?? new Map<string, CalcSubmission>(), bands, course.mode, cutoff),
      );
    }
    return out;
  }

  /**
   * School name and logo (PNG or JPEG as stored; WebP converted to PNG when
   * sharp is available, see report-logo.ts; unreadable logos are left off).
   */
  async school(schoolId: string): Promise<ReportSchool> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, logo_path: true },
    });
    let logo: ReportSchool['logo'] = null;
    if (school?.logo_path) {
      try {
        const bytes = await this.storage.getBuffer(objectKey('images', school.logo_path), LOGO_MAX_BYTES);
        if (bytes) logo = await logoForPdf(new Uint8Array(bytes));
      } catch (error) {
        this.logger.warn(`School logo not added to the report: ${(error as Error).message}`);
      }
    }
    return { name: school?.name ?? 'School', logo };
  }

  /** Present / late / absent / excused for the student's sessions in the term. */
  async attendance(term: TermContext, studentId: string) {
    const from = termStart(term.start_date);
    const to = termCutoff(term.end_date);
    const records = await this.prisma.course_attendance_record.findMany({
      where: {
        student_id: studentId,
        course: { school_id: term.schoolId },
        attendance_session: {
          opened_at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
        },
      },
      // Status only: never location readings or flags.
      select: { status: true },
    });
    return summariseAttendance(records);
  }

  /**
   * Everything one student's term report shows. `issuedAt` is the publish
   * time (or now, for a preview).
   */
  async reportCard(
    term: TermContext,
    studentId: string,
    opts: { issuedAt: Date; preview?: boolean },
  ): Promise<ReportCardDocument> {
    const [student] = await this.students(term.schoolId, [studentId]);
    if (!student) throw new NotFoundException('Student not found');

    const courses = await this.coursesForTerm(term);
    const enrolled = await this.enrolments(courses.map((c) => c.id));
    const mine = courses.filter((c) => (enrolled.get(c.id) ?? []).includes(studentId));

    const [grades, comments, head, attendance, school] = await Promise.all([
      Promise.all(mine.map((c) => this.courseGrades(c, term, [studentId]))),
      mine.length
        ? this.prisma.report_comment.findMany({
            where: { term_id: term.id, student_id: studentId, course_id: { in: mine.map((c) => c.id) } },
            select: { course_id: true, body: true },
          })
        : Promise.resolve([] as { course_id: string; body: string }[]),
      this.prisma.report_head_comment.findUnique({
        where: { term_id_student_id: { term_id: term.id, student_id: studentId } },
        select: { body: true },
      }),
      this.attendance(term, studentId),
      this.school(term.schoolId),
    ]);
    const commentOf = new Map(comments.map((c) => [c.course_id, c.body]));

    return {
      school,
      student: { name: studentDisplayName(student) },
      term: {
        name: term.name,
        yearName: term.yearName,
        startDate: dateOnly(term.start_date),
        endDate: dateOnly(term.end_date),
      },
      courses: mine.map((c, i) => ({
        name: c.name,
        code: c.code,
        teachers: c.teachers.join(', '),
        percent: grades[i].get(studentId)?.percent ?? null,
        letter: grades[i].get(studentId)?.letter ?? null,
        comment: commentOf.get(c.id) ?? null,
      })),
      attendance,
      headComment: head?.body ?? null,
      issuedAt: opts.issuedAt,
      preview: opts.preview,
    };
  }

  /**
   * A student's transcript rows: every term (of `termIds`, or all of the
   * school's) in which they were enrolled in a reportable course.
   */
  async transcriptTerms(schoolId: string, studentId: string, termIds?: Set<string>): Promise<TranscriptTerm[]> {
    const terms = (await this.terms(schoolId)).filter((t) => !termIds || termIds.has(t.id));
    const out: TranscriptTerm[] = [];
    for (const term of terms) {
      const courses = await this.coursesForTerm(term);
      const enrolled = await this.enrolments(courses.map((c) => c.id));
      const mine = courses.filter((c) => (enrolled.get(c.id) ?? []).includes(studentId));
      if (mine.length === 0) continue;
      const grades = await Promise.all(mine.map((c) => this.courseGrades(c, term, [studentId])));
      out.push({
        yearName: term.yearName,
        termName: term.name,
        startDate: dateOnly(term.start_date),
        endDate: dateOnly(term.end_date),
        courses: mine.map((c, i) => ({
          name: c.name,
          code: c.code,
          percent: grades[i].get(studentId)?.percent ?? null,
          letter: grades[i].get(studentId)?.letter ?? null,
        })),
      });
    }
    return out;
  }

  async transcript(schoolId: string, studentId: string, termIds?: Set<string>): Promise<TranscriptDocument> {
    const [student] = await this.students(schoolId, [studentId]);
    if (!student) throw new NotFoundException('Student not found');
    const [terms, school] = await Promise.all([
      this.transcriptTerms(schoolId, studentId, termIds),
      this.school(schoolId),
    ]);
    return { school, student: { name: studentDisplayName(student) }, terms, generatedAt: new Date() };
  }
}
