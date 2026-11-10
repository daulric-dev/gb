/**
 * Reading roster CSVs into a RosterSnapshot: a OneRoster 1.2 CSV bundle
 * (orgs, academicSessions, users (+ roles in 1.2), classes, enrollments;
 * also the 1.1 layout with `role` and `orgSourcedIds` on users.csv) and
 * GradeBook's own simple templates (students, staff, classes, enrolments).
 * Pure functions; the CSV parser is the gradebook import's (RFC 4180).
 */
import { parseCsv } from '@/grading/gradebook-import';
import {
  emptySnapshot,
  type EnrolmentRole,
  type RosterSnapshot,
  type SessionType,
  type SnapshotPart,
  type UserKind,
} from './roster-types';

/** Largest single CSV accepted, in characters. */
export const ROSTER_MAX_CSV_LENGTH = 40_000_000;
/** Most row errors kept per run (the rest are counted). */
export const MAX_ROW_ERRORS = 5000;

export interface CsvFile {
  name: string;
  text: string;
}

interface Table {
  file: string;
  headers: string[];
  rows: { line: number; get: (col: string) => string }[];
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');

function readTable(file: CsvFile, snap: RosterSnapshot): Table | null {
  let raw: { line: number; cells: string[] }[];
  try {
    raw = parseCsv(file.text, ROSTER_MAX_CSV_LENGTH);
  } catch (err) {
    pushError(snap, { file: file.name, line: null, sourcedId: null, message: (err as Error).message });
    return null;
  }
  if (raw.length === 0) return { file: file.name, headers: [], rows: [] };
  const headers = raw[0].cells.map(norm);
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });
  return {
    file: file.name,
    headers,
    rows: raw.slice(1).map((r) => ({
      line: r.line,
      get: (col: string) => {
        const i = index.get(norm(col));
        return i === undefined ? '' : (r.cells[i] ?? '').trim();
      },
    })),
  };
}

function pushError(snap: RosterSnapshot, e: RosterSnapshot['errors'][number]) {
  if (snap.errors.length < MAX_ROW_ERRORS) snap.errors.push(e);
}

function requireColumns(table: Table, cols: string[], snap: RosterSnapshot): boolean {
  const missing = cols.filter((c) => !table.headers.includes(norm(c)));
  if (missing.length === 0) return true;
  pushError(snap, {
    file: table.file,
    line: 1,
    sourcedId: null,
    message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
  });
  return false;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanEmail(value: string): string | null | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return EMAIL.test(v) && v.length <= 320 ? v : undefined;
}

export function cleanDate(value: string): string | null | undefined {
  const v = value.trim().slice(0, 10);
  if (!v) return null;
  if (!DATE.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const truthy = (value: string) => !/^(false|0|no|n)$/i.test(value.trim());

/** OneRoster user role -> student, staff, or null (parents, guardians: not rostered). */
export function userKind(role: string): UserKind | null {
  const r = role.trim().toLowerCase();
  if (r === 'student') return 'student';
  if (['teacher', 'administrator', 'aide', 'proctor'].includes(r)) return 'staff';
  return null;
}

/** OneRoster enrolment role -> GradeBook role, or null (administrator: no course role). */
export function enrolmentRole(role: string): EnrolmentRole | null {
  const r = role.trim().toLowerCase();
  if (r === 'student') return 'student';
  if (r === 'teacher') return 'teacher';
  if (r === 'aide' || r === 'proctor' || r === 'ta') return 'ta';
  return null;
}

export function sessionType(type: string): SessionType | null {
  const t = type.trim();
  const found = (['schoolYear', 'term', 'semester', 'gradingPeriod'] as const).find(
    (k) => k.toLowerCase() === t.toLowerCase(),
  );
  return found ?? null;
}

const deleted = (status: string) => status.trim().toLowerCase() === 'tobedeleted';

function markPresent(snap: RosterSnapshot, part: SnapshotPart) {
  if (!snap.present.includes(part)) snap.present.push(part);
}

// --- OneRoster CSV bundle ---------------------------------------------------

/** True when the files look like a OneRoster bundle (users.csv or orgs.csv). */
export function isOneRosterBundle(files: Map<string, string>): boolean {
  return files.has('users.csv') || files.has('orgs.csv') || files.has('manifest.csv');
}

export function parseOneRosterCsv(files: Map<string, string>): RosterSnapshot {
  const snap = emptySnapshot();
  const file = (name: string): Table | null => {
    const text = files.get(name);
    return text === undefined ? null : readTable({ name, text }, snap);
  };
  const seen = new Map<string, Set<string>>();
  const dup = (part: string, id: string, table: Table, line: number) => {
    const set = seen.get(part) ?? new Set<string>();
    seen.set(part, set);
    if (set.has(id)) {
      pushError(snap, { file: table.file, line, sourcedId: id, message: 'Duplicate sourcedId; the first row is used' });
      return true;
    }
    set.add(id);
    return false;
  };

  const orgs = file('orgs.csv');
  if (orgs && requireColumns(orgs, ['sourcedId', 'name'], snap)) {
    markPresent(snap, 'orgs');
    for (const r of orgs.rows) {
      const id = r.get('sourcedId');
      if (!id) {
        pushError(snap, { file: orgs.file, line: r.line, sourcedId: null, message: 'sourcedId is empty' });
        continue;
      }
      if (deleted(r.get('status')) || dup('orgs', id, orgs, r.line)) continue;
      snap.orgs.push({ sourcedId: id, name: r.get('name') || id, type: r.get('type') || null, identifier: r.get('identifier') || null });
    }
  }

  const sessions = file('academicsessions.csv');
  if (sessions && requireColumns(sessions, ['sourcedId', 'title', 'type'], snap)) {
    markPresent(snap, 'sessions');
    for (const r of sessions.rows) {
      const id = r.get('sourcedId');
      const type = sessionType(r.get('type'));
      const start = cleanDate(r.get('startDate'));
      const end = cleanDate(r.get('endDate'));
      const problems: string[] = [];
      if (!id) problems.push('sourcedId is empty');
      if (!r.get('title')) problems.push('title is empty');
      if (!type) problems.push(`Unknown session type "${r.get('type')}"`);
      if (start === undefined) problems.push('startDate is not a date (YYYY-MM-DD)');
      if (end === undefined) problems.push('endDate is not a date (YYYY-MM-DD)');
      if (problems.length) {
        pushError(snap, { file: sessions.file, line: r.line, sourcedId: id || null, message: problems.join('; ') });
        continue;
      }
      if (deleted(r.get('status')) || dup('sessions', id, sessions, r.line)) continue;
      snap.sessions.push({
        sourcedId: id,
        title: r.get('title'),
        type: type!,
        startDate: start ?? null,
        endDate: end ?? null,
        parentSourcedId: r.get('parentSourcedId') || null,
        schoolYear: r.get('schoolYear') || null,
      });
    }
  }

  // 1.2 keeps roles in roles.csv; 1.1 has role + orgSourcedIds on users.csv.
  const roles = new Map<string, { kind: UserKind | null; orgs: string[] }>();
  const rolesTable = file('roles.csv');
  if (rolesTable && requireColumns(rolesTable, ['userSourcedId', 'role', 'orgSourcedId'], snap)) {
    for (const r of rolesTable.rows) {
      if (deleted(r.get('status'))) continue;
      const user = r.get('userSourcedId');
      const kind = userKind(r.get('role'));
      const entry = roles.get(user) ?? { kind: null, orgs: [] };
      // A student role wins over a staff one for the same person.
      if (kind && (entry.kind === null || kind === 'student')) entry.kind = kind;
      const org = r.get('orgSourcedId');
      if (org && !entry.orgs.includes(org)) entry.orgs.push(org);
      roles.set(user, entry);
    }
  }

  const users = file('users.csv');
  if (users && requireColumns(users, ['sourcedId', 'givenName', 'familyName'], snap)) {
    const hasRoleColumn = users.headers.includes('role');
    if (!hasRoleColumn && !rolesTable) {
      pushError(snap, {
        file: users.file,
        line: 1,
        sourcedId: null,
        message: 'users.csv has no role column and there is no roles.csv',
      });
    } else {
      markPresent(snap, 'students');
      markPresent(snap, 'staff');
      for (const r of users.rows) {
        const id = r.get('sourcedId');
        if (!id) {
          pushError(snap, { file: users.file, line: r.line, sourcedId: null, message: 'sourcedId is empty' });
          continue;
        }
        if (deleted(r.get('status'))) continue;
        if (r.get('enabledUser') && !truthy(r.get('enabledUser'))) continue;
        const role = hasRoleColumn
          ? { kind: userKind(r.get('role')), orgs: list(r.get('orgSourcedIds')) }
          : (roles.get(id) ?? { kind: null, orgs: [] });
        if (!role.kind) continue; // parents, guardians and the like are not rostered
        const problems: string[] = [];
        const email = cleanEmail(r.get('email'));
        const dob = cleanDate(r.get('birthDate') || r.get('dateOfBirth'));
        if (!r.get('givenName') && !r.get('familyName')) problems.push('givenName and familyName are empty');
        if (email === undefined) problems.push(`email "${r.get('email')}" is not an email address`);
        if (dob === undefined) problems.push('birthDate is not a date (YYYY-MM-DD)');
        const orgIds = role.orgs.length ? role.orgs : list(r.get('primaryOrgSourcedId'));
        if (orgIds.length === 0) problems.push('The person belongs to no org');
        if (problems.length) {
          pushError(snap, { file: users.file, line: r.line, sourcedId: id, message: problems.join('; ') });
          continue;
        }
        if (dup('users', id, users, r.line)) continue;
        snap.users.push({
          sourcedId: id,
          kind: role.kind,
          givenName: r.get('preferredGivenName') || r.get('givenName'),
          familyName: r.get('preferredFamilyName') || r.get('familyName'),
          email: email ?? null,
          identifier: r.get('identifier') || null,
          dateOfBirth: dob ?? null,
          orgSourcedIds: orgIds,
        });
      }
    }
  }

  const classes = file('classes.csv');
  if (classes && requireColumns(classes, ['sourcedId', 'title', 'schoolSourcedId'], snap)) {
    markPresent(snap, 'classes');
    for (const r of classes.rows) {
      const id = r.get('sourcedId');
      const problems: string[] = [];
      if (!id) problems.push('sourcedId is empty');
      if (!r.get('title')) problems.push('title is empty');
      if (!r.get('schoolSourcedId')) problems.push('schoolSourcedId is empty');
      if (problems.length) {
        pushError(snap, { file: classes.file, line: r.line, sourcedId: id || null, message: problems.join('; ') });
        continue;
      }
      if (deleted(r.get('status')) || dup('classes', id, classes, r.line)) continue;
      snap.classes.push({
        sourcedId: id,
        title: r.get('title').slice(0, 200),
        classCode: r.get('classCode') || null,
        schoolSourcedId: r.get('schoolSourcedId'),
        termSourcedIds: list(r.get('termSourcedIds')),
      });
    }
  }

  const enrollments = file('enrollments.csv');
  if (enrollments && requireColumns(enrollments, ['sourcedId', 'classSourcedId', 'userSourcedId', 'role'], snap)) {
    markPresent(snap, 'enrollments');
    for (const r of enrollments.rows) {
      const id = r.get('sourcedId');
      const role = enrolmentRole(r.get('role'));
      const problems: string[] = [];
      if (!id) problems.push('sourcedId is empty');
      if (!r.get('classSourcedId')) problems.push('classSourcedId is empty');
      if (!r.get('userSourcedId')) problems.push('userSourcedId is empty');
      if (problems.length) {
        pushError(snap, { file: enrollments.file, line: r.line, sourcedId: id || null, message: problems.join('; ') });
        continue;
      }
      if (!role || deleted(r.get('status')) || dup('enrollments', id, enrollments, r.line)) continue;
      snap.enrollments.push({
        sourcedId: id,
        classSourcedId: r.get('classSourcedId'),
        userSourcedId: r.get('userSourcedId'),
        role,
      });
    }
  }

  if (snap.present.length === 0 && snap.errors.length === 0) {
    pushError(snap, {
      file: '(bundle)',
      line: null,
      sourcedId: null,
      message: 'No OneRoster files found (orgs.csv, academicSessions.csv, users.csv, classes.csv, enrollments.csv)',
    });
  }
  return snap;
}

// --- GradeBook templates ----------------------------------------------------

export type TemplateKind = 'students' | 'staff' | 'classes' | 'enrolments';

/** The downloadable templates: a header and one example row each. */
export const TEMPLATES: Record<TemplateKind, { columns: string[]; example: string[] }> = {
  students: {
    columns: ['student_id', 'first_name', 'last_name', 'email', 'student_number', 'school', 'date_of_birth'],
    example: ['S-1001', 'Jordan', 'Rivera', 'jordan.rivera@students.example.org', '1001', 'MAIN', '2012-04-30'],
  },
  staff: {
    columns: ['staff_id', 'first_name', 'last_name', 'email', 'school'],
    example: ['T-201', 'Ada', 'Lovelace', 'ada.lovelace@example.org', 'MAIN'],
  },
  classes: {
    columns: ['class_id', 'name', 'code', 'school', 'academic_year', 'term'],
    example: ['C-MATH7A', 'Mathematics 7A', 'MATH7A', 'MAIN', '2026-2027', 'Term 1'],
  },
  enrolments: {
    columns: ['class_id', 'person_id', 'role'],
    example: ['C-MATH7A', 'S-1001', 'student'],
  },
};

export function templateCsv(kind: TemplateKind): string {
  const t = TEMPLATES[kind];
  return `${t.columns.join(',')}\r\n${t.example.join(',')}\r\n`;
}

/** Which template a file is, from its first column. */
export function templateKindOf(text: string): TemplateKind | null {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const col = norm(first.split(',')[0]?.replace(/"/g, '') ?? '');
  if (col === 'student_id') return 'students';
  if (col === 'staff_id') return 'staff';
  if (col === 'class_id') {
    return norm(first.split(',')[1]?.replace(/"/g, '') ?? '') === 'person_id' ? 'enrolments' : 'classes';
  }
  return null;
}

/** The org a template row's `school` column names; blank = the source's default school. */
export const DEFAULT_ORG = 'default';

export function parseTemplates(files: CsvFile[]): RosterSnapshot {
  const snap = emptySnapshot();
  const orgs = new Set<string>();
  const sessions = new Map<string, RosterSnapshot['sessions'][number]>();
  const seen = new Map<string, Set<string>>();
  const orgOf = (value: string) => {
    const org = value.trim() || DEFAULT_ORG;
    orgs.add(org);
    return org;
  };
  const dup = (kind: string, id: string, file: string, line: number) => {
    const set = seen.get(kind) ?? new Set<string>();
    seen.set(kind, set);
    if (set.has(id)) {
      pushError(snap, { file, line, sourcedId: id, message: 'Duplicate id; the first row is used' });
      return true;
    }
    set.add(id);
    return false;
  };

  for (const f of files) {
    const kind = templateKindOf(f.text);
    if (!kind) {
      pushError(snap, {
        file: f.name,
        line: 1,
        sourcedId: null,
        message: 'Not a GradeBook template: the first column must be student_id, staff_id or class_id',
      });
      continue;
    }
    const table = readTable(f, snap);
    if (!table) continue;
    const required = TEMPLATES[kind].columns.filter((c) =>
      ['student_id', 'staff_id', 'class_id', 'person_id', 'first_name', 'last_name', 'name'].includes(c),
    );
    if (kind === 'staff') required.push('email');
    if (!requireColumns(table, required, snap)) continue;

    for (const r of table.rows) {
      const problems: string[] = [];
      if (kind === 'students' || kind === 'staff') {
        const idCol = kind === 'students' ? 'student_id' : 'staff_id';
        const id = r.get(idCol);
        const email = cleanEmail(r.get('email'));
        const dob = kind === 'students' ? cleanDate(r.get('date_of_birth')) : null;
        if (!id) problems.push(`${idCol} is empty`);
        if (!r.get('first_name') && !r.get('last_name')) problems.push('first_name and last_name are empty');
        if (email === undefined) problems.push(`email "${r.get('email')}" is not an email address`);
        if (kind === 'staff' && email === null) problems.push('email is required for staff');
        if (dob === undefined) problems.push('date_of_birth is not a date (YYYY-MM-DD)');
        if (problems.length) {
          pushError(snap, { file: f.name, line: r.line, sourcedId: id || null, message: problems.join('; ') });
          continue;
        }
        if (dup('user', id, f.name, r.line)) continue;
        markPresent(snap, kind === 'students' ? 'students' : 'staff');
        snap.users.push({
          sourcedId: id,
          kind: kind === 'students' ? 'student' : 'staff',
          givenName: r.get('first_name'),
          familyName: r.get('last_name'),
          email: email ?? null,
          identifier: kind === 'students' ? r.get('student_number') || null : null,
          dateOfBirth: dob ?? null,
          orgSourcedIds: [orgOf(r.get('school'))],
        });
      } else if (kind === 'classes') {
        const id = r.get('class_id');
        if (!id) problems.push('class_id is empty');
        if (!r.get('name')) problems.push('name is empty');
        const year = r.get('academic_year');
        const term = r.get('term');
        if (term && !year) problems.push('term needs an academic_year');
        if (problems.length) {
          pushError(snap, { file: f.name, line: r.line, sourcedId: id || null, message: problems.join('; ') });
          continue;
        }
        if (dup('class', id, f.name, r.line)) continue;
        markPresent(snap, 'classes');
        const terms: string[] = [];
        if (year) {
          const yearId = `year:${year}`;
          if (!sessions.has(yearId)) {
            sessions.set(yearId, { sourcedId: yearId, title: year, type: 'schoolYear', startDate: null, endDate: null, parentSourcedId: null, schoolYear: year });
          }
          if (term) {
            const termId = `term:${year}:${term}`;
            if (!sessions.has(termId)) {
              sessions.set(termId, { sourcedId: termId, title: term, type: 'term', startDate: null, endDate: null, parentSourcedId: yearId, schoolYear: year });
            }
            terms.push(termId);
          } else {
            terms.push(yearId);
          }
        }
        snap.classes.push({
          sourcedId: id,
          title: r.get('name').slice(0, 200),
          classCode: r.get('code') || null,
          schoolSourcedId: orgOf(r.get('school')),
          termSourcedIds: terms,
        });
      } else {
        const cls = r.get('class_id');
        const person = r.get('person_id');
        const role = enrolmentRole(r.get('role') || 'student');
        if (!cls) problems.push('class_id is empty');
        if (!person) problems.push('person_id is empty');
        if (!role) problems.push(`Unknown role "${r.get('role')}" (student, teacher or ta)`);
        if (problems.length) {
          pushError(snap, { file: f.name, line: r.line, sourcedId: null, message: problems.join('; ') });
          continue;
        }
        const id = `${cls}:${person}`;
        if (dup('enrolment', id, f.name, r.line)) continue;
        markPresent(snap, 'enrollments');
        snap.enrollments.push({ sourcedId: id, classSourcedId: cls, userSourcedId: person, role: role! });
      }
    }
  }
  snap.orgs = [...orgs].map((id) => ({
    sourcedId: id,
    name: id === DEFAULT_ORG ? 'Default school (blank school column)' : id,
    type: 'school',
    identifier: null,
  }));
  snap.sessions = [...sessions.values()];
  if (snap.sessions.length) markPresent(snap, 'sessions');
  return snap;
}
