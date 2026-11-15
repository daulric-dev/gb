import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { FeatureService } from '@/features/feature.service';
import { userSchoolId } from '@/common/user-school';
import { restrictedStudents } from '@/student-restriction/restriction';
import { safeTimeZone } from '@/common/time-zone';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import { CourseAccessService, STAFF_ROLES } from '@/course/access/course-access.service';
import { calculateCourseGrade, type CalcSubmission } from '@/grading/gradebook.calc';
import { scaleFromRow } from '@/mastery/mastery.calc';
import { masteryByStudentOutcome } from '@/mastery/mastery.service';
import {
  DEFAULT_RULES,
  atRiskReasons,
  classify,
  distribution,
  rollUp,
  round1,
  slug,
  toCsv,
  submissionRates,
  weeklyTrend,
  type AtRiskRules,
  type CellInput,
  type CellState,
  type Distribution,
  type RiskReason,
  type RollUp,
  type SubmissionRates,
  type SummaryCounts,
  type TrendPoint,
} from './analytics.calc';

/** The school-wide key: the school analytics page, and any course's analytics. */
export const ANALYTICS_PERMISSION = 'analytics:read';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Courses the sweep summarises (drafts have nothing to report; templates no students). */
const SUMMARISED = ['published', 'archived'] as const;

/** What the analytics need of a course. */
export interface AnalyticsCourse {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
}

export interface CellRow {
  student_id: string;
  activity_id: string;
  status: 'draft' | 'submitted' | 'graded' | null;
  score: number | null;
  excused: boolean;
  submitted_at: Date | null;
  graded_at: Date | null;
  late_seconds: number;
  due_at: Date | null;
}

export interface AttendanceRow {
  student_id: string;
  attended: number;
  counted: number;
}

/**
 * One cell per enrolled student × published activity, with the student's
 * own due date (extension, else the activity's) and their submission, if
 * any (at most one per student and activity). Submissions of students not
 * on the roster are left out.
 */
export function courseCells(
  activities: { id: string; due_at: Date | null }[],
  roster: { student: { id: string } }[],
  submissions: {
    activity_id: string;
    student_id: string;
    status: string;
    score: { toString(): string } | number | null;
    excused: boolean | null;
    submitted_at: Date | null;
    graded_at: Date | null;
    late_seconds: number | null;
  }[],
  extensions: { activity_id: string; student_id: string; due_at: Date }[],
): CellRow[] {
  const key = (activityId: string, studentId: string) => `${activityId}|${studentId}`;
  const subs = new Map(submissions.map((s) => [key(s.activity_id, s.student_id), s]));
  const ext = new Map(extensions.map((x) => [key(x.activity_id, x.student_id), x.due_at]));
  const cells: CellRow[] = [];
  for (const a of activities) {
    for (const { student } of roster) {
      const k = key(a.id, student.id);
      const s = subs.get(k);
      cells.push({
        student_id: student.id,
        activity_id: a.id,
        status: (s?.status ?? null) as CellRow['status'],
        score: s && s.score !== null ? Number(s.score.toString()) : null,
        excused: s?.excused ?? false,
        submitted_at: s?.submitted_at ?? null,
        graded_at: s?.graded_at ?? null,
        late_seconds: s?.late_seconds ?? 0,
        due_at: ext.get(k) ?? a.due_at,
      });
    }
  }
  return cells;
}

/** Attended (present or late) and counted (not excused) records per student. */
export function attendanceRows(
  counts: { student_id: string; status: string; _count: { _all: number } }[],
): AttendanceRow[] {
  const byStudent = new Map<string, AttendanceRow>();
  for (const row of counts) {
    const r = byStudent.get(row.student_id) ?? { student_id: row.student_id, attended: 0, counted: 0 };
    if (row.status === 'present' || row.status === 'late') r.attended += row._count._all;
    if (row.status !== 'excused') r.counted += row._count._all;
    byStudent.set(row.student_id, r);
  }
  return [...byStudent.values()];
}

export interface ActivityAnalytics extends SubmissionRates {
  id: string;
  title: string;
  kind: 'quiz' | 'assignment' | 'offline';
  points: number;
  dueAt: string | null;
  group: string | null;
  distribution: Distribution;
}

export interface AtRiskStudent {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  grade: number | null;
  missingRecent: number;
  attendanceRate: number | null;
  masteryScore: number | null;
  reasons: RiskReason[];
}

export interface CourseAnalytics {
  course: { id: string; name: string; code: string | null };
  generatedAt: string;
  timeZone: string;
  rules: AtRiskRules;
  features: { attendance: boolean; mastery: boolean };
  students: number;
  overview: {
    averageGrade: number | null;
    medianGrade: number | null;
    submission: SubmissionRates;
    attendanceRate: number | null;
    atRisk: number;
  };
  activities: ActivityAnalytics[];
  gradeDistribution: Distribution;
  groups: { groupId: string | null; name: string; weight: number | null; average: number | null; students: number }[];
  trend: TrendPoint[];
  atRisk: AtRiskStudent[];
}

/** A wire rules object from a stored row (or the defaults). */
export function rulesFromRow(
  row: {
    min_grade: number | null;
    missing_count: number | null;
    window_weeks: number;
    min_attendance: number | null;
    mastery_below_level: number | null;
  } | null,
): AtRiskRules {
  if (!row) return { ...DEFAULT_RULES };
  return {
    minGrade: row.min_grade,
    missingCount: row.missing_count,
    windowWeeks: row.window_weeks,
    minAttendance: row.min_attendance,
    masteryBelowLevel: row.mastery_below_level,
  };
}

const byName = (a: { lastName: string | null; firstName: string | null }, b: typeof a) =>
  `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(`${b.lastName ?? ''} ${b.firstName ?? ''}`);

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Course and school analytics.
 *
 * A course's analytics are computed on request for that one course, in a
 * fixed handful of queries whatever its size (activities, groups, roster,
 * submissions, extensions, one grouped attendance query, mastery evidence). The
 * school views read only `analytics_course_summary` / `analytics_at_risk`,
 * which `refreshSchool` (the sweep, or "refresh now") writes from the same
 * course computation.
 *
 * Who sees what: a course's staff see its analytics through their course
 * role; `analytics:read` sees any course's and the school's. Students and
 * parents never reach these routes (no course staff role, no school keys).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly features: FeatureService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** The caller's active school, as a member. */
  async memberSchool(userId: string): Promise<{ schoolId: string; keys: string[] }> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    const eff = await loadEffectivePermissions(this.prisma, this.cache, userId, schoolId);
    if (!eff.member) throw new ForbiddenException('You are not a member of this school');
    return { schoolId, keys: eff.keys };
  }

  /**
   * A course the caller may see analytics for: their own (any staff role), or
   * any course of a school where they hold `analytics:read`. Anything else,
   * including another school's course, is a 404.
   */
  async authorizeCourse(userId: string, courseId: string): Promise<AnalyticsCourse> {
    try {
      const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
      return { id: course.id, school_id: course.school_id, name: course.name, code: course.code ?? null };
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, school_id: true, name: true, code: true, is_template: true },
      });
      if (!course || course.is_template) throw err;
      const eff = await loadEffectivePermissions(this.prisma, this.cache, userId, course.school_id);
      if (!eff.member || !eff.keys.includes(ANALYTICS_PERMISSION)) throw err;
      return { id: course.id, school_id: course.school_id, name: course.name, code: course.code };
    }
  }

  // ── settings ─────────────────────────────────────────────────────────────

  async rules(schoolId: string): Promise<AtRiskRules> {
    return rulesFromRow(await this.prisma.analytics_setting.findUnique({ where: { school_id: schoolId } }));
  }

  async settings(userId: string) {
    const { schoolId } = await this.memberSchool(userId);
    const f = await this.features.effective(schoolId);
    return { rules: await this.rules(schoolId), features: { attendance: f.attendance, mastery: f.mastery } };
  }

  async updateSettings(userId: string, patch: Partial<AtRiskRules>) {
    const { schoolId } = await this.memberSchool(userId);
    const next = { ...(await this.rules(schoolId)), ...patch };
    const data = {
      min_grade: next.minGrade,
      missing_count: next.missingCount,
      window_weeks: next.windowWeeks,
      min_attendance: next.minAttendance,
      mastery_below_level: next.masteryBelowLevel,
      updated_by: userId,
      updated_at: new Date(),
    };
    await this.prisma.analytics_setting.upsert({
      where: { school_id: schoolId },
      create: { school_id: schoolId, ...data },
      update: data,
    });
    return this.settings(userId);
  }

  // ── course ───────────────────────────────────────────────────────────────

  async course(userId: string, courseId: string, now = new Date()): Promise<CourseAnalytics> {
    const course = await this.authorizeCourse(userId, courseId);
    return (await this.computeCourse(course, now)).view;
  }

  /** Everything for one course: the view, the summary counts and the at-risk rows. */
  async computeCourse(
    course: AnalyticsCourse,
    now: Date,
    ctx?: { rules: AtRiskRules; attendance: boolean; mastery: boolean; timeZone: string; masteryScale?: ReturnType<typeof scaleFromRow> },
  ): Promise<{ view: CourseAnalytics; counts: SummaryCounts }> {
    const c = ctx ?? (await this.context(course.school_id));
    const courseId = course.id;
    const since = new Date(now.getTime() - c.rules.windowWeeks * WEEK_MS);

    const [groups, activities, roster, submissions, extensions, attendanceCounts, evidence] = await Promise.all([
      this.prisma.assignment_group.findMany({
        where: { course_id: courseId },
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        select: { id: true, name: true, weight: true, position: true, drop_lowest: true, drop_highest: true },
      }),
      this.prisma.activity.findMany({
        where: { course_id: courseId, status: { in: ['published', 'closed'] } },
        orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
        select: {
          id: true,
          title: true,
          kind: true,
          points: true,
          due_at: true,
          status: true,
          assignment_group_id: true,
          omit_from_final_grade: true,
        },
      }),
      this.prisma.course_student.findMany({
        where: { course_id: courseId, status: { in: ['active', 'completed'] } },
        select: { student: { select: { id: true, first_name: true, last_name: true } } },
      }),
      // The submissions and extensions of the course's published work; the
      // roster × activity cells are put together below.
      this.prisma.submission.findMany({
        where: { activity: { course_id: courseId, status: { in: ['published', 'closed'] } } },
        select: {
          activity_id: true,
          student_id: true,
          status: true,
          score: true,
          excused: true,
          submitted_at: true,
          graded_at: true,
          late_seconds: true,
        },
      }),
      this.prisma.activity_extension.findMany({
        where: { activity: { course_id: courseId, status: { in: ['published', 'closed'] } } },
        select: { activity_id: true, student_id: true, due_at: true },
      }),
      // Attendance records per student and status in the window.
      c.attendance
        ? this.prisma.course_attendance_record.groupBy({
            by: ['student_id', 'status'],
            where: {
              course_id: courseId,
              attendance_session: { opened_at: { gte: since, lte: now } },
            },
            _count: { _all: true },
          })
        : Promise.resolve([] as { student_id: string; status: string; _count: { _all: number } }[]),
      c.mastery
        ? this.prisma.outcome_evidence.findMany({
            where: { course_id: courseId },
            select: {
              id: true,
              outcome_id: true,
              student_id: true,
              course_id: true,
              activity_id: true,
              source: true,
              ratio: true,
              rating_rank: true,
              rating_count: true,
              assessed_at: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const cells = courseCells(activities, roster, submissions, extensions);
    const attendance = attendanceRows(attendanceCounts);

    const acts = activities.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      points: Number(a.points),
      dueAt: a.due_at,
      status: a.status as 'published' | 'closed',
      groupId: a.assignment_group_id,
      omit: a.omit_from_final_grade,
    }));
    const actById = new Map(acts.map((a) => [a.id, a]));
    const calcGroups = groups.map((g) => ({
      id: g.id,
      name: g.name,
      weight: g.weight === null ? null : Number(g.weight),
      position: g.position,
      dropLowest: g.drop_lowest ?? 0,
      dropHighest: g.drop_highest ?? 0,
    }));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const calcActs = acts.map((a) => ({
      id: a.id,
      assignmentGroupId: a.groupId,
      points: a.points,
      status: a.status,
      omitFromFinalGrade: a.omit,
    }));

    const students = roster.map((r) => r.student);
    const studentIds = new Set(students.map((s) => s.id));

    // Per activity and per student, from the one cell query.
    const statesByActivity = new Map<string, CellState[]>();
    const marksByActivity = new Map<string, number[]>();
    const subsByStudent = new Map<string, Map<string, CalcSubmission>>();
    const missingRecent = new Map<string, number>();
    const trendMarks: { at: Date; percent: number }[] = [];
    const allStates: CellState[] = [];

    for (const row of cells) {
      const a = actById.get(row.activity_id);
      if (!a || !studentIds.has(row.student_id)) continue;
      const score = num(row.score);
      const cell: CellInput = {
        kind: a.kind,
        status: row.status,
        score,
        excused: !!row.excused,
        submittedAt: row.submitted_at,
        lateSeconds: Number(row.late_seconds) || 0,
        dueAt: row.due_at,
      };
      const state = classify(cell, now);
      allStates.push(state);
      const list = statesByActivity.get(a.id) ?? [];
      list.push(state);
      statesByActivity.set(a.id, list);
      if (state === 'missing' && row.due_at && row.due_at.getTime() >= since.getTime()) {
        missingRecent.set(row.student_id, (missingRecent.get(row.student_id) ?? 0) + 1);
      }
      if (row.status !== null) {
        const subs = subsByStudent.get(row.student_id) ?? new Map<string, CalcSubmission>();
        subs.set(a.id, { status: row.status, score, excused: !!row.excused });
        subsByStudent.set(row.student_id, subs);
      }
      if (row.status === 'graded' && !row.excused && score !== null && a.points > 0) {
        const percent = (score / a.points) * 100;
        const marks = marksByActivity.get(a.id) ?? [];
        marks.push(percent);
        marksByActivity.set(a.id, marks);
        const at = a.dueAt ?? row.submitted_at ?? row.graded_at;
        if (at) trendMarks.push({ at, percent });
      }
    }

    // Course grades, by the gradebook's own rules.
    const grades = new Map<string, ReturnType<typeof calculateCourseGrade>>();
    for (const s of students) {
      grades.set(s.id, calculateCourseGrade(calcGroups, calcActs, subsByStudent.get(s.id) ?? new Map()));
    }
    const gradeValues = [...grades.values()].map((g) => g.percent).filter((p): p is number => p !== null);
    const gradeDistribution = distribution(gradeValues);

    // Group averages over students with marked work in the group.
    const groupAgg = new Map<string, { groupId: string | null; name: string; weight: number | null; sum: number; n: number }>();
    for (const g of calcGroups) groupAgg.set(g.id, { groupId: g.id, name: g.name, weight: g.weight, sum: 0, n: 0 });
    for (const g of grades.values()) {
      for (const gs of g.groups) {
        const key = gs.groupId ?? '';
        const agg = groupAgg.get(key) ?? { groupId: gs.groupId, name: gs.name, weight: gs.weight, sum: 0, n: 0 };
        if (gs.percent !== null) {
          agg.sum += gs.percent;
          agg.n++;
        }
        groupAgg.set(key, agg);
      }
    }

    // Attendance and mastery signals.
    const att = new Map(attendance.map((r) => [r.student_id, { attended: Number(r.attended), counted: Number(r.counted) }]));
    let attCounted = 0;
    let attAttended = 0;
    for (const [sid, r] of att) {
      if (!studentIds.has(sid)) continue;
      attCounted += r.counted;
      attAttended += r.attended;
    }
    const scale = c.mastery ? (c.masteryScale ?? scaleFromRow(await this.masteryRow(course.school_id))) : null;
    const masteryMean = new Map<string, number>();
    if (scale && evidence.length) {
      const per = masteryByStudentOutcome(evidence as never, scale);
      const sums = new Map<string, { sum: number; n: number }>();
      for (const [key, r] of per) {
        if (r.score === null) continue;
        const sid = key.split(':')[0];
        const cur = sums.get(sid) ?? { sum: 0, n: 0 };
        cur.sum += r.score;
        cur.n++;
        sums.set(sid, cur);
      }
      for (const [sid, v] of sums) masteryMean.set(sid, Math.round((v.sum / v.n) * 100) / 100);
    }

    // Students restricted from profiling (exclude_from_analytics) are never
    // listed at risk; counts and averages still include them.
    const excluded = await restrictedStudents(
      this.prisma,
      'exclude_from_analytics',
      students.map((s) => s.id),
    );
    const atRisk: AtRiskStudent[] = [];
    for (const s of students) {
      if (excluded.has(s.id)) continue;
      const a = att.get(s.id);
      const signals = {
        grade: grades.get(s.id)?.percent ?? null,
        missingRecent: missingRecent.get(s.id) ?? 0,
        attendanceRate: c.attendance && a && a.counted > 0 ? round1((a.attended / a.counted) * 100) : null,
        masteryScore: c.mastery ? (masteryMean.get(s.id) ?? null) : null,
      };
      const reasons = atRiskReasons(signals, c.rules, {
        attendance: c.attendance,
        mastery: c.mastery,
        levelLabel: (l) => scale?.levels[l - 1] ?? null,
      });
      if (reasons.length) {
        atRisk.push({
          studentId: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          grade: signals.grade === null ? null : round1(signals.grade),
          missingRecent: signals.missingRecent,
          attendanceRate: signals.attendanceRate,
          masteryScore: signals.masteryScore,
          reasons,
        });
      }
    }
    atRisk.sort((x, y) => y.reasons.length - x.reasons.length || byName(x, y));

    const submission = submissionRates(allStates);
    const view: CourseAnalytics = {
      course: { id: course.id, name: course.name, code: course.code },
      generatedAt: now.toISOString(),
      timeZone: c.timeZone,
      rules: c.rules,
      features: { attendance: c.attendance, mastery: c.mastery },
      students: students.length,
      overview: {
        averageGrade: gradeDistribution.mean,
        medianGrade: gradeDistribution.median,
        submission,
        attendanceRate: c.attendance && attCounted > 0 ? round1((attAttended / attCounted) * 100) : null,
        atRisk: atRisk.length,
      },
      activities: acts.map((a) => ({
        id: a.id,
        title: a.title,
        kind: a.kind,
        points: a.points,
        dueAt: a.dueAt ? a.dueAt.toISOString() : null,
        group: a.groupId ? (groupName.get(a.groupId) ?? null) : null,
        ...submissionRates(statesByActivity.get(a.id) ?? []),
        distribution: distribution(marksByActivity.get(a.id) ?? []),
      })),
      gradeDistribution,
      groups: [...groupAgg.values()].map((g) => ({
        groupId: g.groupId,
        name: g.name,
        weight: g.weight,
        average: g.n ? round1(g.sum / g.n) : null,
        students: g.n,
      })),
      trend: weeklyTrend(trendMarks, c.timeZone),
      atRisk,
    };
    const counts: SummaryCounts = {
      students: students.length,
      gradedStudents: gradeValues.length,
      gradeSum: gradeValues.reduce((x, y) => x + y, 0),
      onTime: submission.onTime,
      late: submission.late,
      missing: submission.missing,
      excused: submission.excused,
      attendanceCounted: c.attendance ? attCounted : 0,
      attendanceAttended: c.attendance ? attAttended : 0,
      atRisk: atRisk.length,
    };
    return { view, counts };
  }

  private masteryRow(schoolId: string) {
    return this.prisma.mastery_setting.findUnique({ where: { school_id: schoolId } });
  }

  /** Rules, features and zone for a school (loaded once per sweep). */
  async context(schoolId: string) {
    const [rules, f, school] = await Promise.all([
      this.rules(schoolId),
      this.features.effective(schoolId),
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { time_zone: true } }),
    ]);
    const masteryScale = f.mastery ? scaleFromRow(await this.masteryRow(schoolId)) : undefined;
    return {
      rules,
      attendance: !!f.attendance,
      mastery: !!f.mastery,
      timeZone: safeTimeZone(school?.time_zone),
      masteryScale,
    };
  }

  // ── school (cached summaries only) ─────────────────────────────────────────

  private courseFilter(schoolId: string, f: SchoolFilter) {
    return {
      school_id: schoolId,
      is_template: false,
      ...(f.termId ? { term_id: f.termId } : {}),
      ...(f.academicYearId ? { academic_year_id: f.academicYearId } : {}),
    };
  }

  async school(userId: string, f: SchoolFilter = {}) {
    const { schoolId } = await this.memberSchool(userId);
    const [rows, refresh, years, terms] = await Promise.all([
      this.prisma.analytics_course_summary.findMany({
        where: { school_id: schoolId, course: this.courseFilter(schoolId, f) },
        include: {
          course: {
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              term_id: true,
              academic_year_id: true,
              course_staff: {
                where: { role: 'teacher' },
                select: { user_profile: { select: { id: true, first_name: true, last_name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.analytics_refresh.findUnique({ where: { school_id: schoolId } }),
      this.prisma.academic_year.findMany({
        where: { school_id: schoolId },
        orderBy: { start_date: 'desc' },
        select: { id: true, name: true },
      }),
      this.prisma.term.findMany({
        where: { academic_year: { school_id: schoolId } },
        orderBy: [{ start_date: 'desc' }, { sort_order: 'asc' }],
        select: { id: true, name: true, academic_year_id: true },
      }),
    ]);
    const atRiskStudents = rows.length
      ? new Set(
          (
            await this.prisma.analytics_at_risk.findMany({
              where: { school_id: schoolId, course_id: { in: rows.map((r) => r.course_id) } },
              select: { student_id: true },
            })
          ).map((r) => r.student_id),
        ).size
      : 0;

    const counts = (r: (typeof rows)[number]): SummaryCounts => ({
      students: r.students,
      gradedStudents: r.graded_students,
      gradeSum: r.grade_sum,
      onTime: r.on_time,
      late: r.late,
      missing: r.missing,
      excused: r.excused,
      attendanceCounted: r.attendance_counted,
      attendanceAttended: r.attendance_attended,
      atRisk: r.at_risk,
    });

    const courses = rows
      .map((r) => ({
        courseId: r.course_id,
        name: r.course.name,
        code: r.course.code,
        status: r.course.status,
        termId: r.course.term_id,
        academicYearId: r.course.academic_year_id,
        teachers: r.course.course_staff.map((s) => personName(s.user_profile)),
        computedAt: r.computed_at.toISOString(),
        ...rollUp([counts(r)]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const byTeacher = new Map<string, { name: string; rows: SummaryCounts[] }>();
    for (const r of rows) {
      for (const s of r.course.course_staff) {
        const t = byTeacher.get(s.user_profile.id) ?? { name: personName(s.user_profile), rows: [] };
        t.rows.push(counts(r));
        byTeacher.set(s.user_profile.id, t);
      }
    }
    const teachers = [...byTeacher.entries()]
      .map(([teacherId, t]) => ({ teacherId, name: t.name, ...rollUp(t.rows) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      lastUpdated: refresh?.refreshed_at.toISOString() ?? null,
      filter: { termId: f.termId ?? null, academicYearId: f.academicYearId ?? null },
      filters: { academicYears: years, terms },
      totals: { ...rollUp(rows.map(counts)), atRiskStudents } as RollUp & { atRiskStudents: number },
      courses,
      teachers,
    };
  }

  /**
   * The school's at-risk list (per-student rows; needs `analytics:read`,
   * enforced by the route). From the last refresh.
   */
  async schoolAtRisk(userId: string, f: SchoolFilter = {}) {
    const { schoolId } = await this.memberSchool(userId);
    const [rows, refresh] = await Promise.all([
      this.prisma.analytics_at_risk.findMany({
        where: { school_id: schoolId, course: this.courseFilter(schoolId, f) },
        select: {
          course_id: true,
          student_id: true,
          grade: true,
          missing: true,
          attendance_rate: true,
          mastery_score: true,
          reasons: true,
          computed_at: true,
          course: { select: { name: true, code: true } },
          student: { select: { first_name: true, last_name: true } },
        },
      }),
      this.prisma.analytics_refresh.findUnique({ where: { school_id: schoolId } }),
    ]);
    const students = rows
      .map((r) => ({
        studentId: r.student_id,
        firstName: r.student.first_name,
        lastName: r.student.last_name,
        courseId: r.course_id,
        courseName: r.course.name,
        courseCode: r.course.code,
        grade: r.grade,
        missingRecent: r.missing,
        attendanceRate: r.attendance_rate,
        masteryScore: r.mastery_score,
        reasons: Array.isArray(r.reasons) ? (r.reasons as unknown as RiskReason[]) : [],
      }))
      .sort((a, b) => b.reasons.length - a.reasons.length || byName(a, b) || a.courseName.localeCompare(b.courseName));
    return { lastUpdated: refresh?.refreshed_at.toISOString() ?? null, students };
  }

  // ── refresh ──────────────────────────────────────────────────────────────

  /**
   * Recompute one school's summaries from the raw tables. Replaces each
   * course's summary and at-risk rows, removes rows of courses no longer
   * summarised, and stamps `analytics_refresh`: running it twice in a row
   * leaves the same rows (idempotent). Does nothing while the feature is off.
   */
  async refreshSchool(schoolId: string, now = new Date()): Promise<number> {
    const started = Date.now();
    if (!(await this.features.isEnabled(schoolId, 'analytics'))) return 0;
    const ctx = await this.context(schoolId);
    const courses = await this.prisma.course.findMany({
      where: { school_id: schoolId, is_template: false, status: { in: [...SUMMARISED] } },
      select: { id: true, school_id: true, name: true, code: true },
    });
    let done = 0;
    for (const course of courses) {
      try {
        const { view, counts } = await this.computeCourse(course, now, ctx);
        const data = {
          school_id: schoolId,
          students: counts.students,
          graded_students: counts.gradedStudents,
          grade_sum: counts.gradeSum,
          on_time: counts.onTime,
          late: counts.late,
          missing: counts.missing,
          excused: counts.excused,
          attendance_counted: counts.attendanceCounted,
          attendance_attended: counts.attendanceAttended,
          at_risk: counts.atRisk,
          computed_at: now,
        };
        await this.prisma.$transaction([
          this.prisma.analytics_course_summary.upsert({
            where: { course_id: course.id },
            create: { course_id: course.id, ...data },
            update: data,
          }),
          this.prisma.analytics_at_risk.deleteMany({ where: { course_id: course.id } }),
          this.prisma.analytics_at_risk.createMany({
            data: view.atRisk.map((s) => ({
              course_id: course.id,
              student_id: s.studentId,
              school_id: schoolId,
              grade: s.grade,
              missing: s.missingRecent,
              attendance_rate: s.attendanceRate,
              mastery_score: s.masteryScore,
              reasons: s.reasons as never,
              computed_at: now,
            })),
            skipDuplicates: true,
          }),
        ]);
        done++;
      } catch (err) {
        this.logger.error(`Analytics for course ${course.id} failed: ${(err as Error).message}`);
      }
    }
    const ids = courses.map((c) => c.id);
    await this.prisma.$transaction([
      this.prisma.analytics_course_summary.deleteMany({ where: { school_id: schoolId, course_id: { notIn: ids } } }),
      this.prisma.analytics_at_risk.deleteMany({ where: { school_id: schoolId, course_id: { notIn: ids } } }),
      this.prisma.analytics_refresh.upsert({
        where: { school_id: schoolId },
        create: { school_id: schoolId, refreshed_at: now, courses: done, duration_ms: Date.now() - started },
        update: { refreshed_at: now, courses: done, duration_ms: Date.now() - started },
      }),
    ]);
    return done;
  }

  /** Every school with the feature on. Returns the courses refreshed. */
  async sweep(now = new Date()): Promise<number> {
    const schools = await this.prisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const s of schools) {
      try {
        total += await this.refreshSchool(s.id, now);
      } catch (err) {
        this.logger.error(`Analytics for school ${s.id} failed: ${(err as Error).message}`);
      }
    }
    return total;
  }

  // ── CSV ──────────────────────────────────────────────────────────────────

  /** One table of the course view. */
  async courseCsv(userId: string, courseId: string, table: CourseTable, now = new Date()) {
    const v = await this.course(userId, courseId, now);
    return { csv: courseTableCsv(v, table), filename: `${slugOf(v.course)}-analytics-${table}.csv` };
  }

  async schoolCsv(userId: string, table: SchoolTable, f: SchoolFilter = {}) {
    if (table === 'at-risk') {
      const r = await this.schoolAtRisk(userId, f);
      return { csv: atRiskCsv(r.students, true), filename: 'school-analytics-at-risk.csv' };
    }
    const s = await this.school(userId, f);
    const head = ['Courses', 'Enrolments', 'Average grade %', 'Submission rate %', 'On time', 'Late', 'Missing', 'Attendance %', 'At risk'];
    const cells = (r: RollUp) => [r.courses, r.enrolments, r.averageGrade, r.submissionRate, r.onTime, r.late, r.missing, r.attendanceRate, r.atRisk];
    const lines =
      table === 'teachers'
        ? [['Teacher', ...head], ...s.teachers.map((t) => [t.name, ...cells(t)])]
        : [
            ['Course', 'Code', 'Teachers', ...head.slice(1)],
            ...s.courses.map((c) => [c.name, c.code, c.teachers.join('; '), ...cells(c).slice(1)]),
          ];
    return { csv: toCsv(lines), filename: `school-analytics-${table}.csv` };
  }
}

export interface SchoolFilter {
  termId?: string;
  academicYearId?: string;
}

export const COURSE_TABLES = ['activities', 'distribution', 'groups', 'trend', 'at-risk'] as const;
export type CourseTable = (typeof COURSE_TABLES)[number];
export const SCHOOL_TABLES = ['courses', 'teachers', 'at-risk'] as const;
export type SchoolTable = (typeof SCHOOL_TABLES)[number];

function personName(p: { first_name: string | null; last_name: string | null }): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
}

const slugOf = (c: { code: string | null; name: string }) => slug(c.code || c.name);

const reasonText = (r: RiskReason[]) => r.map((x) => x.text).join('; ');

function atRiskCsv(
  rows: (AtRiskStudent & { courseName?: string })[],
  withCourse: boolean,
): string {
  return toCsv([
    [
      'Last name',
      'First name',
      ...(withCourse ? ['Course'] : []),
      'Grade %',
      'Missing (recent)',
      'Attendance %',
      'Mastery',
      'Reasons',
    ],
    ...rows.map((s) => [
      s.lastName,
      s.firstName,
      ...(withCourse ? [s.courseName ?? ''] : []),
      s.grade,
      s.missingRecent,
      s.attendanceRate,
      s.masteryScore,
      reasonText(s.reasons),
    ]),
  ]);
}

/** A course view table as CSV (formula-safe). */
export function courseTableCsv(v: CourseAnalytics, table: CourseTable): string {
  switch (table) {
    case 'activities':
      return toCsv([
        ['Activity', 'Kind', 'Group', 'Points', 'Due', 'On time', 'Late', 'Missing', 'Excused', 'Not yet due', 'Submission rate %', 'Marked', 'Median %', 'Q1 %', 'Q3 %', 'Mean %'],
        ...v.activities.map((a) => [
          a.title,
          a.kind,
          a.group ?? '',
          a.points,
          a.dueAt ?? '',
          a.onTime,
          a.late,
          a.missing,
          a.excused,
          a.pending,
          a.rate,
          a.distribution.count,
          a.distribution.median,
          a.distribution.q1,
          a.distribution.q3,
          a.distribution.mean,
        ]),
      ]);
    case 'distribution': {
      const d = v.gradeDistribution;
      return toCsv([
        ['Range %', 'Students'],
        ...d.histogram.map((b) => [`${b.from}-${b.to}`, b.count]),
        [],
        ['Statistic', 'Value'],
        ['Students with a grade', d.count],
        ['Minimum %', d.min],
        ['Q1 %', d.q1],
        ['Median %', d.median],
        ['Q3 %', d.q3],
        ['Maximum %', d.max],
        ['Mean %', d.mean],
      ]);
    }
    case 'groups':
      return toCsv([
        ['Group', 'Weight', 'Average %', 'Students'],
        ...v.groups.map((g) => [g.name, g.weight, g.average, g.students]),
      ]);
    case 'trend':
      return toCsv([['Week of', 'Average %', 'Marks'], ...v.trend.map((t) => [t.week, t.average, t.count])]);
    case 'at-risk':
      return atRiskCsv(v.atRisk, false);
  }
}
