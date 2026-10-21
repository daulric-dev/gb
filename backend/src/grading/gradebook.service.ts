import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import {
  CourseAccessService,
  CourseRow,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import {
  ACTIVITY_COLUMNS,
  toActivity,
  toPortalActivity,
} from './activity.mapper';
import { AssignmentGroupService } from './assignment-group.service';
import {
  CalcBand,
  CalcSubmission,
  calculateCourseGrade,
  letterFor,
} from './gradebook.calc';

type Group = Awaited<
  ReturnType<AssignmentGroupService['loadForCourse']>
>[number];

/** The `CourseGrade` contract. */
export interface CourseGrade {
  percent: number | null;
  letter: string | null;
  groups: {
    groupId: string | null;
    name: string;
    weight: number | null;
    earned: number;
    possible: number;
    percent: number | null;
  }[];
}

/**
 * The course gradebook: every student's marks and totals.
 *
 * It reads submissions only - the submission is the mark - and leaves the
 * arithmetic to gradebook.calc.ts so the teacher's grid, the student's grades
 * page and the portal course cards cannot drift apart.
 */
@Injectable()
export class GradebookService {
  private readonly logger = new Logger(GradebookService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly access: CourseAccessService,
    private readonly groups: AssignmentGroupService,
  ) {}

  private get client() {
    return this.supabaseService.getServiceClient();
  }

  /**
   * The course's published and closed activities, soonest due first; undated
   * work last, in the order it was made.
   */
  private async loadActivities(courseId: string): Promise<any[]> {
    const { data, error } = await this.client
      .schema('grading')
      .from('activity')
      .select(ACTIVITY_COLUMNS)
      .eq('course_id', courseId)
      .in('status', ['published', 'closed'])
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(
        `Failed to load gradebook activities: ${error.message}`,
      );
      throw new BadRequestException('Failed to load the gradebook');
    }
    return data ?? [];
  }

  private async loadSubmissions(
    activityIds: string[],
    studentIds?: string[],
  ): Promise<any[]> {
    if (activityIds.length === 0) return [];
    if (studentIds && studentIds.length === 0) return [];

    let query = this.client
      .schema('grading')
      .from('submission')
      .select(
        'activity_id, student_id, status, score, excused, feedback, submitted_at, attempt_count',
      )
      .in('activity_id', activityIds);
    if (studentIds) query = query.in('student_id', studentIds);

    const { data, error } = await query;
    if (error) {
      this.logger.error(`Failed to load submissions: ${error.message}`);
      throw new BadRequestException('Failed to load the gradebook');
    }
    return data ?? [];
  }

  /** The course's scale, else the school's default; null when neither. */
  private async loadBands(course: CourseRow): Promise<CalcBand[]> {
    let scaleId = course.grade_scale_id;

    if (!scaleId) {
      const { data } = await this.client
        .schema('grading')
        .from('grade_scale')
        .select('id')
        .eq('school_id', course.school_id)
        .eq('is_default', true)
        .maybeSingle();
      scaleId = (data?.id as string | undefined) ?? null;
    }
    if (!scaleId) return [];

    const { data: bands } = await this.client
      .schema('grading')
      .from('grade_scale_band')
      .select('label, min_percentage, max_percentage')
      .eq('grade_scale_id', scaleId);

    return (bands ?? []).map((b: any) => ({
      label: b.label as string,
      minPercentage: Number(b.min_percentage),
      maxPercentage: Number(b.max_percentage),
    }));
  }

  private gradeFor(
    groups: Group[],
    activities: any[],
    submissions: Map<string, CalcSubmission>,
    bands: CalcBand[],
  ): CourseGrade {
    const result = calculateCourseGrade(
      groups,
      activities.map((a) => ({
        id: a.id as string,
        assignmentGroupId: (a.assignment_group_id as string | null) ?? null,
        points: Number(a.points),
        status: a.status,
        omitFromFinalGrade: !!a.omit_from_final_grade,
      })),
      submissions,
    );
    return { ...result, letter: letterFor(bands, result.percent) };
  }

  private toCalcSubmission(s: any): CalcSubmission {
    return {
      status: s.status,
      score: s.score === null || s.score === undefined ? null : Number(s.score),
      excused: !!s.excused,
    };
  }

  /** The teacher's grid: the `Gradebook` contract. */
  async gradebook(userId: string, courseId: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    return this.build(course);
  }

  private async build(course: CourseRow) {
    const courseId = course.id;

    const [groups, activities, bands, roster] = await Promise.all([
      this.groups.loadForCourse(courseId),
      this.loadActivities(courseId),
      this.loadBands(course),
      this.client
        .schema('course')
        .from('course_student')
        .select('student_id, status')
        .eq('course_id', courseId)
        .in('status', ['active', 'completed']),
    ]);

    const enrolments = (roster.data ?? []) as any[];
    const studentIds = enrolments.map((r) => r.student_id as string);

    const [{ data: students }, submissions] = await Promise.all([
      studentIds.length
        ? this.client
            .schema('student')
            .from('student')
            .select('id, first_name, last_name')
            .in('id', studentIds)
        : Promise.resolve({ data: [] as any[] }),
      this.loadSubmissions(
        activities.map((a) => a.id as string),
        studentIds,
      ),
    ]);

    const nameOf = new Map(
      (students ?? []).map((s: any) => [s.id as string, s]),
    );
    const byStudent = new Map<string, any[]>();
    for (const s of submissions) {
      const list = byStudent.get(s.student_id) ?? [];
      list.push(s);
      byStudent.set(s.student_id, list);
    }

    const rows = enrolments.map((r) => {
      const student = nameOf.get(r.student_id);
      const own = byStudent.get(r.student_id) ?? [];

      const cells: Record<
        string,
        {
          score: number | null;
          status: 'draft' | 'submitted' | 'graded' | null;
          excused: boolean;
          submittedAt: string | null;
        }
      > = {};
      const calc = new Map<string, CalcSubmission>();

      for (const s of own) {
        cells[s.activity_id] = {
          score: s.score === null ? null : Number(s.score),
          status: s.status ?? null,
          excused: !!s.excused,
          submittedAt: s.submitted_at ?? null,
        };
        calc.set(s.activity_id, this.toCalcSubmission(s));
      }

      return {
        studentId: r.student_id as string,
        firstName: (student?.first_name as string | null) ?? null,
        lastName: (student?.last_name as string | null) ?? null,
        status: r.status as 'active' | 'dropped' | 'completed',
        cells,
        grade: this.gradeFor(groups, activities, calc, bands),
      };
    });

    rows.sort(
      (a, b) =>
        (a.lastName ?? '').localeCompare(b.lastName ?? '') ||
        (a.firstName ?? '').localeCompare(b.firstName ?? ''),
    );

    return {
      groups,
      activities: activities.map((a) => toActivity(a)),
      students: rows,
    };
  }

  /**
   * The gradebook as CSV, for a spreadsheet or the school's records. One row
   * per student: each activity's score ("EX" when excused), each group's
   * percent, then the total and letter.
   */
  async exportCsv(userId: string, courseId: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const book = await this.build(course);

    const groupCols: { id: string | null; name: string }[] = book.groups.map(
      (g) => ({ id: g.id, name: g.name }),
    );
    // Ungrouped only gets a column when some student's grade lists it.
    if (
      book.students.some((s) => s.grade.groups.some((g) => g.groupId === null))
    ) {
      groupCols.push({ id: null, name: 'Ungrouped' });
    }

    const header = [
      'Last name',
      'First name',
      'Status',
      ...book.activities.map((a) => `${a.title} (${a.points})`),
      ...groupCols.map((g) => `${g.name} %`),
      'Total %',
      'Letter',
    ];

    const lines = [header];
    for (const s of book.students) {
      lines.push([
        s.lastName ?? '',
        s.firstName ?? '',
        s.status,
        ...book.activities.map((a) => {
          const cell = s.cells[a.id];
          if (!cell) return '';
          if (cell.excused) return 'EX';
          return cell.score === null ? '' : String(cell.score);
        }),
        ...groupCols.map((g) => {
          const score = s.grade.groups.find((x) => x.groupId === g.id);
          return score?.percent === null || score?.percent === undefined
            ? ''
            : String(score.percent);
        }),
        s.grade.percent === null ? '' : String(s.grade.percent),
        s.grade.letter ?? '',
      ]);
    }

    const csv = lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const base = (course.code || course.name || 'course')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return { csv: csv + '\r\n', filename: `${base || 'course'}-grades.csv` };
  }

  /**
   * One student's course total, for the portal course cards. The caller has
   * already decided the student may see this course; this only computes.
   */
  async studentSummary(
    courseId: string,
    studentId: string,
  ): Promise<CourseGrade> {
    const course = await this.loadCourse(courseId);
    const [groups, activities, bands] = await Promise.all([
      this.groups.loadForCourse(courseId),
      this.loadActivities(courseId),
      this.loadBands(course),
    ]);

    const submissions = await this.loadSubmissions(
      activities.map((a) => a.id as string),
      [studentId],
    );
    const calc = new Map<string, CalcSubmission>(
      submissions.map((s) => [
        s.activity_id as string,
        this.toCalcSubmission(s),
      ]),
    );

    return this.gradeFor(groups, activities, calc, bands);
  }

  private async loadCourse(courseId: string): Promise<CourseRow> {
    const { data } = await this.client
      .schema('course')
      .from('course')
      .select('id, school_id, grade_scale_id')
      .eq('id', courseId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Course not found');
    return data as CourseRow;
  }

  /**
   * The student's grades page: the `PortalCourseGrades` contract. Only
   * published and closed work is listed, and what only staff need (whether
   * an activity counts, when it was made) is left off each activity.
   */
  async studentGrades(studentId: string, courseId: string) {
    const course = await this.access.requireStudent(studentId, courseId);

    const [groups, activities, bands] = await Promise.all([
      this.groups.loadForCourse(courseId),
      this.loadActivities(courseId),
      this.loadBands(course),
    ]);

    const submissions = await this.loadSubmissions(
      activities.map((a) => a.id as string),
      [studentId],
    );
    const byActivity = new Map(
      submissions.map((s) => [s.activity_id as string, s]),
    );
    const calc = new Map<string, CalcSubmission>(
      submissions.map((s) => [
        s.activity_id as string,
        this.toCalcSubmission(s),
      ]),
    );

    const groupName = new Map(groups.map((g) => [g.id, g.name]));

    return {
      grade: this.gradeFor(groups, activities, calc, bands),
      groups,
      activities: activities.map((a) => ({
        ...toPortalActivity(a, byActivity.get(a.id as string)),
        groupName: groupName.get(a.assignment_group_id as string) ?? null,
      })),
    };
  }
}

/**
 * Quote a CSV cell, and defuse anything a spreadsheet would run as a
 * formula: activity titles and student names are user input.
 */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}
