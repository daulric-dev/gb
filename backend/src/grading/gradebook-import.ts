/**
 * Gradebook CSV import, as pure functions: parse the sheet, match its rows to
 * students and its columns to activities, and work out what would change.
 *
 * The sheet is the one GET /courses/:courseId/gradebook/export produces, so a
 * teacher can export, fill marks in a spreadsheet and bring them back. Kept
 * free of Nest and the database so the matching rules are easy to test.
 */

import { roundScore } from './round';

export interface ImportActivity {
  id: string;
  title: string;
  points: number;
  kind: 'quiz' | 'assignment' | 'offline';
}

export interface ImportStudent {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

/** A student's current mark on one activity, as the gradebook has it. */
export interface ImportCurrent {
  score: number | null;
  excused: boolean;
}

export interface ImportColumn {
  index: number;
  header: string;
  activityId: string | null;
  /** matched an activity; ignored (names, totals, unknown); ambiguous. */
  status: 'activity' | 'student' | 'ignored' | 'ambiguous';
}

export interface ImportChange {
  line: number;
  studentId: string;
  studentName: string;
  activityId: string;
  activityTitle: string;
  from: { score: number | null; excused: boolean } | null;
  /** A score, or `excused: true` for an EX cell. */
  to: { score: number | null; excused: boolean };
}

export interface ImportError {
  line: number;
  column: string | null;
  message: string;
}

export interface ImportPlan {
  columns: ImportColumn[];
  rowCount: number;
  matchedRows: number;
  changes: ImportChange[];
  /** Cells that were blank, or already held the value. */
  unchanged: number;
  errors: ImportError[];
}

/** Largest sheet accepted, in characters (same cap as ImportGradebookDto). */
export const MAX_CSV_LENGTH = 1_000_000;

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM.
 * Blank lines are dropped. Returns rows with their 1-based line number.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {

  if (typeof text !== 'string') throw new TypeError('CSV must be text');
  if (text.length > MAX_CSV_LENGTH) {
    throw new RangeError(`CSV is longer than ${MAX_CSV_LENGTH} characters`);
  }

  const src = text.replace(/^\uFEFF/, '');
  
  if (src.length === 0) return [];

  if (src.length > MAX_CSV_LENGTH) {
    throw new RangeError(`CSV is longer than ${MAX_CSV_LENGTH} characters`);
  }

  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length) endRow();
  return rows;
}

/**
 * Undo csvCell's formula guard: the export prefixes a leading = + - @ with
 * a quote so a spreadsheet will not run a title as a formula.
 */
function unguard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

const norm = (v: string | null | undefined) =>
  (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The export's activity header: "Title (points)". */
export function activityHeader(a: { title: string; points: number }): string {
  return `${a.title} (${a.points})`;
}

const STUDENT_HEADERS: Record<string, 'id' | 'last' | 'first' | 'email'> = {
  'student id': 'id',
  id: 'id',
  'last name': 'last',
  'first name': 'first',
  email: 'email',
};

/**
 * Work out what importing `csv` would do.
 *
 * Students are matched by Student ID when the sheet has one (the export
 * does), else by email, else by first and last name - which must pick out
 * exactly one student. Activity columns match the export's "Title (points)"
 * header, or a bare title that names exactly one activity; anything else
 * (Status, group %, Total %, Letter) is ignored.
 *
 * Cells: blank is skipped, a number sets the score (0 to the activity's
 * points, two decimals at most) and lifts any excuse, "EX" excuses. A cell
 * equal to the current mark - compared at two decimals, the way the export
 * wrote it - is not a change, so re-importing an untouched export changes
 * nothing. Quizzes are treated like any other column: their auto-scores
 * are only replaced where the sheet holds a different number.
 */
export function planImport(
  csv: string,
  activities: ImportActivity[],
  students: ImportStudent[],
  current: Map<string, ImportCurrent>,
): ImportPlan {
  const rows = parseCsv(csv);
  const errors: ImportError[] = [];
  const plan: ImportPlan = {
    columns: [],
    rowCount: 0,
    matchedRows: 0,
    changes: [],
    unchanged: 0,
    errors,
  };

  if (rows.length === 0) {
    errors.push({ line: 1, column: null, message: 'The file is empty' });
    return plan;
  }

  const [head, ...body] = rows;
  plan.rowCount = body.length;

  // Columns.
  const byHeader = new Map<string, ImportActivity[]>();
  const byTitle = new Map<string, ImportActivity[]>();
  for (const a of activities) {
    const h = norm(activityHeader(a));
    byHeader.set(h, [...(byHeader.get(h) ?? []), a]);
    const t = norm(a.title);
    byTitle.set(t, [...(byTitle.get(t) ?? []), a]);
  }

  const studentCol: Partial<Record<'id' | 'last' | 'first' | 'email', number>> =
    {};
  const activityCols: { index: number; header: string; activity: ImportActivity }[] =
    [];
  const usedActivities = new Set<string>();

  head.cells.forEach((raw, index) => {
    const header = unguard(raw.trim());
    const key = norm(header);
    const role = STUDENT_HEADERS[key];
    if (role && studentCol[role] === undefined) {
      studentCol[role] = index;
      plan.columns.push({ index, header, activityId: null, status: 'student' });
      return;
    }
    const matches = byHeader.get(key) ?? byTitle.get(key) ?? [];
    if (matches.length === 1 && !usedActivities.has(matches[0].id)) {
      usedActivities.add(matches[0].id);
      activityCols.push({ index, header, activity: matches[0] });
      plan.columns.push({
        index,
        header,
        activityId: matches[0].id,
        status: 'activity',
      });
    } else if (matches.length > 1 || (matches.length === 1 && usedActivities.has(matches[0].id))) {
      plan.columns.push({ index, header, activityId: null, status: 'ambiguous' });
      errors.push({
        line: head.line,
        column: header,
        message:
          matches.length > 1
            ? 'More than one activity has this title; rename one and export again'
            : 'This activity appears in more than one column',
      });
    } else {
      plan.columns.push({ index, header, activityId: null, status: 'ignored' });
    }
  });

  if (
    studentCol.id === undefined &&
    studentCol.email === undefined &&
    (studentCol.last === undefined || studentCol.first === undefined)
  ) {
    errors.push({
      line: head.line,
      column: null,
      message:
        'The sheet needs a Student ID, Email, or First name and Last name column',
    });
    return plan;
  }
  if (activityCols.length === 0) {
    errors.push({
      line: head.line,
      column: null,
      message: 'No column matches an activity in this course',
    });
    return plan;
  }

  // Students.
  const byId = new Map(students.map((s) => [s.id.toLowerCase(), s]));
  const byEmail = new Map<string, ImportStudent[]>();
  const byName = new Map<string, ImportStudent[]>();
  for (const s of students) {
    if (s.email) {
      const e = norm(s.email);
      byEmail.set(e, [...(byEmail.get(e) ?? []), s]);
    }
    const n = `${norm(s.lastName)}|${norm(s.firstName)}`;
    byName.set(n, [...(byName.get(n) ?? []), s]);
  }
  const cellAt = (cells: string[], i: number | undefined) =>
    i === undefined ? '' : unguard((cells[i] ?? '').trim());

  const seenStudents = new Map<string, number>();

  for (const row of body) {
    const id = cellAt(row.cells, studentCol.id);
    const email = cellAt(row.cells, studentCol.email);
    const last = cellAt(row.cells, studentCol.last);
    const first = cellAt(row.cells, studentCol.first);
    const label = `${first} ${last}`.trim() || id || email;

    let student: ImportStudent | undefined;
    let problem: string | null = null;
    if (id) {
      student = byId.get(id.toLowerCase());
      if (!student) problem = `No student with ID ${id} is in this course`;
    } else if (email) {
      const found = byEmail.get(norm(email)) ?? [];
      if (found.length === 1) student = found[0];
      else problem = `No single student in this course has the email ${email}`;
    } else if (last || first) {
      const found = byName.get(`${norm(last)}|${norm(first)}`) ?? [];
      if (found.length === 1) student = found[0];
      else if (found.length > 1) {
        problem = `More than one student is called ${label}; add their Student ID`;
      } else problem = `No student called ${label} is in this course`;
    } else {
      problem = 'This row does not say which student it is';
    }

    if (!student) {
      errors.push({ line: row.line, column: null, message: problem! });
      continue;
    }
    if (seenStudents.has(student.id)) {
      errors.push({
        line: row.line,
        column: null,
        message: `${label} is also on line ${seenStudents.get(student.id)}`,
      });
      continue;
    }
    seenStudents.set(student.id, row.line);
    plan.matchedRows++;

    const name =
      `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || label;

    for (const col of activityCols) {
      const raw = cellAt(row.cells, col.index);
      if (raw === '') {
        plan.unchanged++;
        continue;
      }
      const a = col.activity;
      const now = current.get(`${student.id}:${a.id}`) ?? null;

      if (raw.toUpperCase() === 'EX') {
        if (now?.excused) {
          plan.unchanged++;
          continue;
        }
        plan.changes.push({
          line: row.line,
          studentId: student.id,
          studentName: name,
          activityId: a.id,
          activityTitle: a.title,
          from: now,
          to: { score: now?.score ?? null, excused: true },
        });
        continue;
      }

      if (!/^\d+(\.\d{1,2})?$/.test(raw) && !/^\.\d{1,2}$/.test(raw)) {
        errors.push({
          line: row.line,
          column: col.header,
          message: /^-?\d*\.?\d+$/.test(raw)
            ? `${raw} is not a mark between 0 and ${a.points} with at most two decimals`
            : `"${raw}" is not a number (use EX to excuse)`,
        });
        continue;
      }
      const score = Number(raw);
      if (score < 0 || score > a.points) {
        errors.push({
          line: row.line,
          column: col.header,
          message: `${raw} is outside 0 to ${a.points}`,
        });
        continue;
      }

      const same =
        now !== null &&
        !now.excused &&
        now.score !== null &&
        roundScore(now.score) === score;
      if (same) {
        plan.unchanged++;
        continue;
      }
      plan.changes.push({
        line: row.line,
        studentId: student.id,
        studentName: name,
        activityId: a.id,
        activityTitle: a.title,
        from: now,
        to: { score, excused: false },
      });
    }
  }

  return plan;
}
