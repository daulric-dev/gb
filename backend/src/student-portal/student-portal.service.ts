import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import type { StudentContext } from './student.guard';

/**
 * Report states a student may see. Drafts are staff work in progress; a report
 * becomes the student's once it is published. Widen this if schools want
 * students to see drafts.
 */
const VISIBLE_REPORT_STATUSES = ['published', 'sent_to_ministry'] as const;

/** Shapes of the `public.*` rows this service joins in memory. */
interface SubjectRow {
  id: string;
  name: string | null;
  code: string | null;
  sort_order: number | null;
}
interface TermRow {
  id: string;
  name: string | null;
  sort_order?: number | null;
}
interface YearRow {
  id: string;
  name: string | null;
  is_active?: boolean | null;
}
interface GroupRow {
  id: string;
  name: string | null;
  academic_year_id: string | null;
}

/** Rows carrying the foreign keys resolved through those lookups. */
interface AssessmentRow {
  id: string;
  title: string | null;
  assessment_type: string | null;
  max_score: number | null;
  weight: number | null;
  assessment_date: string | null;
  is_excluded: boolean | null;
  subject_id: string | null;
  term_id: string | null;
}
interface GradeRow {
  id: string;
  score: number | null;
  letter_grade: string | null;
  remarks: string | null;
  is_excluded: boolean | null;
  assessment: AssessmentRow | null;
}
interface EnrollmentRow {
  enrolled_at: string | null;
  student_group_id: string | null;
}
interface AttendanceRow {
  id: string;
  attendance_date: string;
  status: string;
}
interface ReportRow {
  id: string;
  report_type: string | null;
  status: string | null;
  published_at: string | null;
  overall_average: number | null;
  position: number | null;
  total_students: number | null;
  attendance_days: number | null;
  total_school_days: number | null;
  conduct_grade: string | null;
  general_remarks: string | null;
  term_id: string | null;
  academic_year_id: string | null;
}
interface ReportEntryRow {
  id: string;
  sort_order: number | null;
  is_graded: boolean | null;
  term_average: number | null;
  term_grade: number | null;
  term_composite: number | null;
  year_grade: number | null;
  exam_average: number | null;
  coursework_average: number | null;
  letter_grade: string | null;
  teacher_remark: string | null;
  subject_id: string | null;
}

/** Index rows by id for in-memory joins. */
function byId<T extends { id: string }>(rows: T[] | null): Map<string, T> {
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

/** Distinct, non-null foreign keys from a set of rows. */
function idsOf<T>(rows: T[], key: (row: T) => string | null): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (value) out.add(value);
  }
  return [...out];
}

/**
 * Read-only, self-scoped views of a student's own record.
 *
 * Every method takes the StudentContext the guard resolved and filters on
 * `ctx.studentId`. No method accepts a student id from the caller, so there is
 * no parameter to tamper with.
 *
 * Lookups into `public` (subject, term, academic_year, student_group) are
 * fetched separately and joined here rather than embedded: PostgREST cannot
 * embed across schemas, which is why the rest of the codebase joins in JS too.
 */
@Injectable()
export class StudentPortalService {
  private readonly logger = new Logger(StudentPortalService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** The student's own record, school, and class enrolments. */
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

    const { data: enrollments } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select('enrolled_at, student_group_id')
      .eq('student_id', ctx.studentId);

    const rows = (enrollments ?? []) as EnrollmentRow[];
    const groupIds = idsOf(rows, (r) => r.student_group_id);

    const { data: groupData } = groupIds.length
      ? await supabase
          .from('student_group')
          .select('id, name, academic_year_id')
          .in('id', groupIds)
      : { data: [] };
    const groups = (groupData ?? []) as GroupRow[];

    const yearIds = idsOf(groups, (g) => g.academic_year_id);

    const { data: yearData } = yearIds.length
      ? await supabase
          .from('academic_year')
          .select('id, name, is_active')
          .in('id', yearIds)
      : { data: [] };

    const groupMap = byId(groups);
    const yearMap = byId((yearData ?? []) as YearRow[]);

    const classes = rows
      .map((e) => {
        const group = e.student_group_id
          ? groupMap.get(e.student_group_id)
          : undefined;
        if (!group) return null;
        const year = group.academic_year_id
          ? yearMap.get(group.academic_year_id)
          : undefined;
        return {
          id: group.id,
          name: group.name,
          academicYear: year
            ? { id: year.id, name: year.name, isActive: year.is_active ?? false }
            : null,
          enrolledAt: e.enrolled_at,
        };
      })
      .filter(Boolean);

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
      classes,
    };
  }

  /** The student's own grades, grouped by subject. */
  async getGrades(ctx: StudentContext, termId?: string) {
    const supabase = this.supabaseService.getServiceClient();

    // grade -> assessment is within the `grading` schema, so this embed works.
    const { data, error } = await supabase
      .schema('grading')
      .from('grade')
      .select(
        'id, score, letter_grade, remarks, is_excluded, assessment:assessment_id(id, title, assessment_type, max_score, weight, assessment_date, is_excluded, subject_id, term_id)',
      )
      .eq('student_id', ctx.studentId);

    if (error) {
      this.logger.error(
        `Failed to load grades for student ${ctx.studentId}: ${error.message}`,
      );
      throw new NotFoundException('Could not load grades');
    }

    const rows = ((data ?? []) as unknown as GradeRow[]).filter((g) => {
      if (!g.assessment) return false;
      // An assessment the school excluded from grading is not the student's
      // business, and neither is an individually excluded grade.
      if (g.assessment.is_excluded || g.is_excluded) return false;
      if (termId && g.assessment.term_id !== termId) return false;
      return true;
    });

    if (rows.length === 0) return [];

    const assessments = rows
      .map((r) => r.assessment)
      .filter((a): a is AssessmentRow => a !== null);
    const subjectIds = idsOf(assessments, (a) => a.subject_id);
    const termIds = idsOf(assessments, (a) => a.term_id);

    const { data: subjectData } = subjectIds.length
      ? await supabase
          .from('subject')
          .select('id, name, code, sort_order')
          .in('id', subjectIds)
      : { data: [] };

    const { data: termData } = termIds.length
      ? await supabase
          .from('term')
          .select('id, name, sort_order')
          .in('id', termIds)
      : { data: [] };

    const subjectMap = byId((subjectData ?? []) as SubjectRow[]);
    const termMap = byId((termData ?? []) as TermRow[]);

    const bySubject = new Map<string, any>();

    for (const row of rows) {
      const a = row.assessment;
      if (!a) continue;
      const subject = a.subject_id ? subjectMap.get(a.subject_id) : undefined;
      const key = subject?.id ?? 'unknown';

      if (!bySubject.has(key)) {
        bySubject.set(key, {
          subject: subject
            ? { id: subject.id, name: subject.name, code: subject.code }
            : null,
          sortOrder: subject?.sort_order ?? Number.MAX_SAFE_INTEGER,
          assessments: [],
        });
      }

      const term = a.term_id ? termMap.get(a.term_id) : undefined;

      bySubject.get(key).assessments.push({
        id: a.id,
        title: a.title,
        type: a.assessment_type,
        date: a.assessment_date,
        maxScore: a.max_score,
        weight: a.weight,
        term: term ? { id: term.id, name: term.name } : null,
        score: row.score,
        letterGrade: row.letter_grade,
        remarks: row.remarks,
      });
    }

    return [...bySubject.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((entry) => {
        const scored = entry.assessments.filter(
          (a: any) =>
            typeof a.score === 'number' &&
            typeof a.maxScore === 'number' &&
            a.maxScore > 0,
        );
        const average =
          scored.length > 0
            ? scored.reduce(
                (sum: number, a: any) => sum + (a.score / a.maxScore) * 100,
                0,
              ) / scored.length
            : null;

        return {
          subject: entry.subject,
          assessments: entry.assessments.sort((a: any, b: any) =>
            String(a.date ?? '').localeCompare(String(b.date ?? '')),
          ),
          average: average === null ? null : Math.round(average * 100) / 100,
        };
      });
  }

  /** The student's own attendance, with a status tally. */
  async getAttendance(ctx: StudentContext, from?: string, to?: string) {
    const supabase = this.supabaseService.getServiceClient();

    let query = supabase
      .schema('student')
      .from('attendance_record')
      .select('id, attendance_date, status')
      .eq('student_id', ctx.studentId)
      .order('attendance_date', { ascending: false });

    if (from) query = query.gte('attendance_date', from);
    if (to) query = query.lte('attendance_date', to);

    const { data, error } = await query;

    if (error) {
      this.logger.error(
        `Failed to load attendance for student ${ctx.studentId}: ${error.message}`,
      );
      throw new NotFoundException('Could not load attendance');
    }

    const records = ((data ?? []) as AttendanceRow[]).map((r) => ({
      id: r.id,
      date: r.attendance_date,
      status: r.status,
    }));

    const summary = { present: 0, absent: 0, late: 0, total: records.length };
    for (const r of records) {
      if (r.status === 'present') summary.present += 1;
      else if (r.status === 'absent') summary.absent += 1;
      else if (r.status === 'late') summary.late += 1;
    }

    return { summary, records };
  }

  /** Published report books belonging to this student. */
  async getReports(ctx: StudentContext) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('reporting')
      .from('report_book')
      .select(
        'id, report_type, status, published_at, overall_average, position, total_students, attendance_days, total_school_days, conduct_grade, general_remarks, term_id, academic_year_id',
      )
      .eq('student_id', ctx.studentId)
      .in('status', [...VISIBLE_REPORT_STATUSES])
      .order('published_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Failed to load reports for student ${ctx.studentId}: ${error.message}`,
      );
      throw new NotFoundException('Could not load reports');
    }

    const rows = (data ?? []) as ReportRow[];
    const { termMap, yearMap } = await this.loadReportLookups(rows);

    return rows.map((r) => this.toReportSummary(r, termMap, yearMap));
  }

  /** One published report with its per-subject entries. */
  async getReport(ctx: StudentContext, reportId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: report, error } = await supabase
      .schema('reporting')
      .from('report_book')
      .select(
        'id, student_id, report_type, status, published_at, overall_average, position, total_students, attendance_days, total_school_days, conduct_grade, general_remarks, term_id, academic_year_id',
      )
      .eq('id', reportId)
      // Both filters matter: the ownership check stops id guessing, the status
      // check stops a draft leaking through a known id.
      .eq('student_id', ctx.studentId)
      .in('status', [...VISIBLE_REPORT_STATUSES])
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to load report ${reportId} for student ${ctx.studentId}: ${error.message}`,
      );
      throw new NotFoundException('Report not found');
    }

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const { data: entryRows } = await supabase
      .schema('reporting')
      .from('report_book_entry')
      .select(
        'id, sort_order, is_graded, term_average, term_grade, term_composite, year_grade, exam_average, coursework_average, letter_grade, teacher_remark, subject_id',
      )
      .eq('report_book_id', reportId)
      .order('sort_order', { ascending: true });

    const entries = (entryRows ?? []) as ReportEntryRow[];
    const subjectIds = idsOf(entries, (e) => e.subject_id);

    const { data: subjectData } = subjectIds.length
      ? await supabase
          .from('subject')
          .select('id, name, code')
          .in('id', subjectIds)
      : { data: [] };

    const subjectMap = byId((subjectData ?? []) as SubjectRow[]);
    const { termMap, yearMap } = await this.loadReportLookups([report]);

    return {
      ...this.toReportSummary(report, termMap, yearMap),
      entries: entries.map((e) => {
        const subject = e.subject_id ? subjectMap.get(e.subject_id) : undefined;
        return {
          id: e.id,
          subject: subject
            ? { id: subject.id, name: subject.name, code: subject.code }
            : null,
          isGraded: e.is_graded ?? false,
          termAverage: e.term_average,
          termGrade: e.term_grade,
          termComposite: e.term_composite,
          yearGrade: e.year_grade,
          examAverage: e.exam_average,
          courseworkAverage: e.coursework_average,
          letterGrade: e.letter_grade,
          teacherRemark: e.teacher_remark,
        };
      }),
    };
  }

  /** Terms and academic years referenced by a set of report rows. */
  private async loadReportLookups(rows: ReportRow[]) {
    const supabase = this.supabaseService.getServiceClient();

    const termIds = idsOf(rows, (r) => r.term_id);
    const yearIds = idsOf(rows, (r) => r.academic_year_id);

    const { data: termData } = termIds.length
      ? await supabase.from('term').select('id, name').in('id', termIds)
      : { data: [] };

    const { data: yearData } = yearIds.length
      ? await supabase.from('academic_year').select('id, name').in('id', yearIds)
      : { data: [] };

    return {
      termMap: byId((termData ?? []) as TermRow[]),
      yearMap: byId((yearData ?? []) as YearRow[]),
    };
  }

  private toReportSummary(
    r: ReportRow,
    termMap: Map<string, TermRow>,
    yearMap: Map<string, YearRow>,
  ) {
    const term = r.term_id ? termMap.get(r.term_id) : undefined;
    const year = r.academic_year_id ? yearMap.get(r.academic_year_id) : undefined;

    return {
      id: r.id,
      type: r.report_type,
      status: r.status,
      publishedAt: r.published_at,
      overallAverage: r.overall_average,
      position: r.position,
      totalStudents: r.total_students,
      attendanceDays: r.attendance_days,
      totalSchoolDays: r.total_school_days,
      conductGrade: r.conduct_grade,
      generalRemarks: r.general_remarks,
      term: term ? { id: term.id, name: term.name } : null,
      academicYear: year ? { id: year.id, name: year.name } : null,
    };
  }
}
