/**
 * Report card rules, as pure functions: which courses and which work belong
 * to a term, the final grade and letter per course, the attendance summary
 * and comment completion. Kept free of Nest and the database so they can be
 * tested on their own; the arithmetic itself is gradebook.calc.ts, so a
 * report shows the same number as the gradebook.
 */

import {
  type CalcActivity,
  type CalcBand,
  type CalcGroup,
  type CalcSubmission,
  calculateCourseGrade,
  letterFor,
} from '@/grading/gradebook.calc';

/**
 * How a course belongs to a term:
 *
 * - `term`: the course itself is set to the term (`course.term_id`). Its whole
 *   gradebook is the term's grade.
 * - `year`: a year-long course (`term_id` null, `academic_year_id` = the
 *   term's year). It appears on every term report of that year, graded
 *   cumulatively up to the end of the term: only work due on or before the
 *   term's last day counts (undated work by when it was created).
 *
 * Null when the course is not part of the term at all.
 */
export type CourseTermMode = 'term' | 'year';

export function courseTermMode(
  course: { term_id: string | null; academic_year_id: string | null },
  term: { id: string; academic_year_id: string | null },
): CourseTermMode | null {
  if (course.term_id) return course.term_id === term.id ? 'term' : null;
  if (
    course.academic_year_id &&
    term.academic_year_id &&
    course.academic_year_id === term.academic_year_id
  ) {
    return 'year';
  }
  return null;
}

/**
 * The instant a term ends: the end of its last day (UTC). Null when the
 * term has no end date, meaning "everything so far".
 */
export function termCutoff(endDate: Date | string | null | undefined): Date | null {
  if (!endDate) return null;
  const d = new Date(endDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

/** The instant a term starts: the start of its first day (UTC), or null. */
export function termStart(startDate: Date | string | null | undefined): Date | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whether one activity counts toward a course's grade for the term. */
export function activityInTerm(
  activity: { due_at: Date | string | null; created_at: Date | string | null },
  mode: CourseTermMode,
  cutoff: Date | null,
): boolean {
  if (mode === 'term' || !cutoff) return true;
  const when = activity.due_at ?? activity.created_at;
  if (!when) return true;
  return new Date(when).getTime() <= cutoff.getTime();
}

export interface TermGradeActivity extends CalcActivity {
  due_at: Date | string | null;
  created_at: Date | string | null;
}

export interface FinalGrade {
  percent: number | null;
  letter: string | null;
}

/**
 * One student's final grade for one course in a term: the gradebook's
 * calculation (excused and omitted work left out, weights and drop rules
 * applied) over the work that belongs to the term, with the letter from
 * the course's scale (else the school's default scale).
 */
export function finalCourseGrade(
  groups: CalcGroup[],
  activities: TermGradeActivity[],
  submissions: Map<string, CalcSubmission>,
  bands: CalcBand[],
  mode: CourseTermMode,
  cutoff: Date | null,
): FinalGrade {
  const inTerm = activities.filter((a) => activityInTerm(a, mode, cutoff));
  const result = calculateCourseGrade(groups, inTerm, submissions);
  return { percent: result.percent, letter: letterFor(bands, result.percent) };
}

export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  total: number;
}

/** Counts per status. Only the status is read: never location data. */
export function summariseAttendance(
  records: { status: string }[],
): AttendanceSummary {
  const out: AttendanceSummary = { present: 0, late: 0, absent: 0, excused: 0, total: 0 };
  for (const r of records) {
    if (r.status === 'present' || r.status === 'late' || r.status === 'absent' || r.status === 'excused') {
      out[r.status] += 1;
      out.total += 1;
    }
  }
  return out;
}

export interface CommentCompletion {
  students: number;
  ready: number;
  draft: number;
  missing: number;
}

/**
 * How far a course's comments are: every enrolled student counts once, as
 * ready, draft (written but not marked ready, or an empty draft) or missing.
 */
export function commentCompletion(
  studentIds: string[],
  comments: { student_id: string; status: string; body: string }[],
): CommentCompletion {
  const byStudent = new Map(comments.map((c) => [c.student_id, c]));
  const out: CommentCompletion = { students: studentIds.length, ready: 0, draft: 0, missing: 0 };
  for (const id of studentIds) {
    const c = byStudent.get(id);
    if (!c || (!c.body.trim() && c.status !== 'ready')) out.missing += 1;
    else if (c.status === 'ready') out.ready += 1;
    else out.draft += 1;
  }
  return out;
}

/** "Last, First", or whatever part exists. */
export function studentDisplayName(s: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const first = (s.first_name ?? '').trim();
  const last = (s.last_name ?? '').trim();
  if (first && last) return `${first} ${last}`;
  return first || last || 'Student';
}

/** Sort key for rosters: last name, then first name. */
export function compareStudents(
  a: { first_name: string | null; last_name: string | null },
  b: { first_name: string | null; last_name: string | null },
): number {
  return (
    (a.last_name ?? '').localeCompare(b.last_name ?? '') ||
    (a.first_name ?? '').localeCompare(b.first_name ?? '')
  );
}

/** A filename-safe version of a student's name for PDFs and zip entries. */
export function reportFileName(
  student: { first_name: string | null; last_name: string | null },
  termName: string,
): string {
  const raw = `${student.last_name ?? ''} ${student.first_name ?? ''} ${termName} report`;
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${cleaned || 'report'}.pdf`;
}
