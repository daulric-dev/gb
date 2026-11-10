/**
 * Analytics arithmetic, as pure functions: submission states and rates,
 * distributions (median and quartiles), the weekly trend, at-risk rules and
 * roll-ups. Kept free of Nest and the database so the maths is tested on its
 * own, and so the course view (computed on request) and the sweep (cached
 * summaries) share exactly the same rules.
 */

import { addDays, isoWeekday, localParts } from '@/common/time-zone';
import { csvCell } from '@/grading/gradebook.service';

// ── rules ──────────────────────────────────────────────────────────────────

/** A school's at-risk rules; null switches a rule off. */
export interface AtRiskRules {
  /** Current course grade below this percent. */
  minGrade: number | null;
  /** At least this many pieces of missing work in the last `windowWeeks`. */
  missingCount: number | null;
  windowWeeks: number;
  /** Course attendance over the last `windowWeeks` below this percent (needs `attendance`). */
  minAttendance: number | null;
  /** Average mastery level below this level (needs `mastery`). */
  masteryBelowLevel: number | null;
}

/** What a school without an `analytics_setting` row gets. */
export const DEFAULT_RULES: AtRiskRules = {
  minGrade: 60,
  missingCount: 3,
  windowWeeks: 4,
  minAttendance: 90,
  masteryBelowLevel: 2,
};

/** One decimal, the precision every rate and average is shown at. */
export const round1 = (n: number) => Math.round(n * 10) / 10;

const pct = (num: number, den: number): number | null => (den > 0 ? round1((num / den) * 100) : null);

// ── submission states ──────────────────────────────────────────────────────

export type CellState = 'on_time' | 'late' | 'missing' | 'excused' | 'pending';

/** One enrolled student × one published activity. */
export interface CellInput {
  kind: 'quiz' | 'assignment' | 'offline';
  status: 'draft' | 'submitted' | 'graded' | null;
  score: number | null;
  excused: boolean;
  submittedAt: Date | null;
  lateSeconds: number;
  /** The student's due date: their extension, else the activity's. */
  dueAt: Date | null;
}

/**
 * Whether the student has handed the work in: a hand-in (`submitted_at`, not
 * a draft) or a mark. Offline work has no hand-in, so only a mark counts.
 */
export function handedIn(c: CellInput): boolean {
  const marked = c.status === 'graded' && c.score !== null;
  if (c.kind === 'offline') return marked;
  return marked || (c.submittedAt !== null && c.status !== null && c.status !== 'draft');
}

/**
 * - `excused`: left out of every rate.
 * - `on_time` / `late`: handed in; late when the stored lateness is above 0
 *   (measured from the student's own due date, so an extension is honoured).
 * - `missing`: not handed in and the student's due date has passed. Offline
 *   work is never missing (there is nothing to hand in; an unmarked cell is
 *   the teacher's to fill).
 * - `pending`: not handed in, not yet due (or no due date).
 */
export function classify(c: CellInput, now: Date): CellState {
  if (c.excused) return 'excused';
  if (handedIn(c)) return c.lateSeconds > 0 ? 'late' : 'on_time';
  if (c.kind === 'offline') return 'pending';
  if (c.dueAt && c.dueAt.getTime() <= now.getTime()) return 'missing';
  return 'pending';
}

export interface SubmissionRates {
  onTime: number;
  late: number;
  missing: number;
  excused: number;
  pending: number;
  /** on time + late. */
  handedIn: number;
  /** Handed in over (handed in + missing), in percent; null when neither. */
  rate: number | null;
  /** On time over (handed in + missing). */
  onTimeRate: number | null;
}

export function submissionRates(states: Iterable<CellState>): SubmissionRates {
  const n = { on_time: 0, late: 0, missing: 0, excused: 0, pending: 0 };
  for (const s of states) n[s]++;
  return rateFromCounts(n.on_time, n.late, n.missing, n.excused, n.pending);
}

export function rateFromCounts(onTime: number, late: number, missing: number, excused = 0, pending = 0): SubmissionRates {
  const handed = onTime + late;
  return {
    onTime,
    late,
    missing,
    excused,
    pending,
    handedIn: handed,
    rate: pct(handed, handed + missing),
    onTimeRate: pct(onTime, handed + missing),
  };
}

// ── distributions ──────────────────────────────────────────────────────────

/**
 * The p-quantile (0..1) of sorted values by linear interpolation between
 * closest ranks (R type 7, Excel QUARTILE.INC): [1,2,3,4] → median 2.5,
 * Q1 1.75, Q3 3.25.
 */
export function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface Bin {
  /** Inclusive lower bound, percent. */
  from: number;
  /** Exclusive upper bound, except the last bin, which includes 100. */
  to: number;
  count: number;
}

export interface Distribution {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Ten 10-point bins: 0-10, …, 90-100 (100 itself in the last). */
  histogram: Bin[];
}

const opt1 = (n: number | null) => (n === null ? null : round1(n));

/** Summary statistics and a histogram of percents (clamped to 0..100 for binning). */
export function distribution(values: number[]): Distribution {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const histogram: Bin[] = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, count: 0 }));
  for (const v of sorted) {
    const i = Math.min(9, Math.max(0, Math.floor(v / 10)));
    histogram[i].count++;
  }
  const n = sorted.length;
  return {
    count: n,
    min: n ? round1(sorted[0]) : null,
    max: n ? round1(sorted[n - 1]) : null,
    mean: n ? round1(sorted.reduce((a, b) => a + b, 0) / n) : null,
    median: opt1(quantile(sorted, 0.5)),
    q1: opt1(quantile(sorted, 0.25)),
    q3: opt1(quantile(sorted, 0.75)),
    histogram,
  };
}

// ── weekly trend ───────────────────────────────────────────────────────────

/** The Monday (YYYY-MM-DD) of the local week an instant falls in. */
export function weekOf(at: Date, timeZone: string): string {
  const date = localParts(at, timeZone).date;
  return addDays(date, 1 - isoWeekday(date));
}

export interface TrendPoint {
  /** Monday of the week. */
  week: string;
  /** Mean mark percent of the marks in that week. */
  average: number;
  count: number;
}

/**
 * Average mark per week, oldest first, only weeks with marks; at most the
 * last `maxWeeks` of them. A mark belongs to the week of its activity's due
 * date (else when it was handed in, else when it was marked).
 */
export function weeklyTrend(
  marks: { at: Date; percent: number }[],
  timeZone: string,
  maxWeeks = 26,
): TrendPoint[] {
  const by = new Map<string, { sum: number; count: number }>();
  for (const m of marks) {
    const w = weekOf(m.at, timeZone);
    const cur = by.get(w) ?? { sum: 0, count: 0 };
    cur.sum += m.percent;
    cur.count++;
    by.set(w, cur);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxWeeks)
    .map(([week, v]) => ({ week, average: round1(v.sum / v.count), count: v.count }));
}

// ── at risk ────────────────────────────────────────────────────────────────

export interface StudentSignals {
  /** Current course grade, percent; null with nothing marked. */
  grade: number | null;
  /** Missing work due in the last `windowWeeks`. */
  missingRecent: number;
  /** Attendance over the last `windowWeeks`; null when nothing counted or attendance is off. */
  attendanceRate: number | null;
  /** Mean mastery score over the course's outcomes with evidence; null when none or mastery is off. */
  masteryScore: number | null;
}

export type RiskRule = 'grade' | 'missing' | 'attendance' | 'mastery';

export interface RiskReason {
  rule: RiskRule;
  text: string;
}

export interface RiskContext {
  attendance: boolean;
  mastery: boolean;
  /** Label of a mastery level (1-based), for the reason text. */
  levelLabel?: (level: number) => string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Why a student is at risk; empty when they are not. A rule with no data
 * (no grade yet, no attendance counted, no mastery evidence) never fires,
 * and the attendance and mastery rules apply only while their features are on.
 */
export function atRiskReasons(s: StudentSignals, rules: AtRiskRules, ctx: RiskContext): RiskReason[] {
  const out: RiskReason[] = [];
  const weeks = plural(rules.windowWeeks, 'week', 'weeks');
  if (rules.minGrade !== null && s.grade !== null && s.grade < rules.minGrade) {
    out.push({ rule: 'grade', text: `Current grade ${round1(s.grade)}% is below ${rules.minGrade}%` });
  }
  if (rules.missingCount !== null && s.missingRecent >= rules.missingCount) {
    out.push({
      rule: 'missing',
      text: `${plural(s.missingRecent, 'piece', 'pieces')} of work missing in the last ${weeks}`,
    });
  }
  if (ctx.attendance && rules.minAttendance !== null && s.attendanceRate !== null && s.attendanceRate < rules.minAttendance) {
    out.push({
      rule: 'attendance',
      text: `Attendance ${round1(s.attendanceRate)}% over the last ${weeks} is below ${rules.minAttendance}%`,
    });
  }
  if (ctx.mastery && rules.masteryBelowLevel !== null && s.masteryScore !== null && s.masteryScore < rules.masteryBelowLevel) {
    const label = ctx.levelLabel?.(rules.masteryBelowLevel);
    out.push({
      rule: 'mastery',
      text: `Average mastery ${Math.round(s.masteryScore * 100) / 100} is below level ${rules.masteryBelowLevel}${label ? ` (${label})` : ''}`,
    });
  }
  return out;
}

// ── roll-ups ───────────────────────────────────────────────────────────────

/** The counts a course summary row keeps. */
export interface SummaryCounts {
  students: number;
  gradedStudents: number;
  gradeSum: number;
  onTime: number;
  late: number;
  missing: number;
  excused: number;
  attendanceCounted: number;
  attendanceAttended: number;
  atRisk: number;
}

export interface RollUp {
  courses: number;
  /** Enrolments (a student in two courses counts twice). */
  enrolments: number;
  /** Mean of the students' current grades, pooled across the courses. */
  averageGrade: number | null;
  submissionRate: number | null;
  onTime: number;
  late: number;
  missing: number;
  attendanceRate: number | null;
  /** Student-course pairs at risk. */
  atRisk: number;
}

/**
 * Exact roll-up of course summaries: sums of counts, then the rates, so a
 * large course weighs as much as its students and work (never an average of
 * averages).
 */
export function rollUp(rows: SummaryCounts[]): RollUp {
  const t = rows.reduce(
    (a, r) => ({
      students: a.students + r.students,
      gradedStudents: a.gradedStudents + r.gradedStudents,
      gradeSum: a.gradeSum + r.gradeSum,
      onTime: a.onTime + r.onTime,
      late: a.late + r.late,
      missing: a.missing + r.missing,
      attendanceCounted: a.attendanceCounted + r.attendanceCounted,
      attendanceAttended: a.attendanceAttended + r.attendanceAttended,
      atRisk: a.atRisk + r.atRisk,
    }),
    { students: 0, gradedStudents: 0, gradeSum: 0, onTime: 0, late: 0, missing: 0, attendanceCounted: 0, attendanceAttended: 0, atRisk: 0 },
  );
  return {
    courses: rows.length,
    enrolments: t.students,
    averageGrade: t.gradedStudents > 0 ? round1(t.gradeSum / t.gradedStudents) : null,
    submissionRate: pct(t.onTime + t.late, t.onTime + t.late + t.missing),
    onTime: t.onTime,
    late: t.late,
    missing: t.missing,
    attendanceRate: pct(t.attendanceAttended, t.attendanceCounted),
    atRisk: t.atRisk,
  };
}

// ── CSV ────────────────────────────────────────────────────────────────────

const cellText = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : v;

/** CRLF CSV; every cell through `csvCell`, which defuses spreadsheet formulas. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => csvCell(cellText(v))).join(',')).join('\r\n') + '\r\n';
}

/** A file-name-safe slug ("course" when nothing is left). */
export function slug(s: string | null | undefined, fallback = 'course'): string {
  return (s ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}
