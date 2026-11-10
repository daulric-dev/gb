/**
 * The normalised roster every source turns into (OneRoster CSV bundle,
 * GradeBook CSV templates, OneRoster REST), and the change set a dry run
 * produces from it. Kept free of Nest and the database.
 */

export const ROSTER_ENTITIES = [
  'school',
  'academic_year',
  'term',
  'course',
  'student',
  'staff',
  'enrolment',
  'course_staff',
] as const;
export type RosterEntity = (typeof ROSTER_ENTITIES)[number];

export type ChangeAction = 'create' | 'update' | 'disable' | 'error';

/** A OneRoster org (a school, district, ...): mapped to a GradeBook school by the admin. */
export interface SrcOrg {
  sourcedId: string;
  name: string;
  type: string | null;
  identifier: string | null;
}

export type SessionType = 'schoolYear' | 'term' | 'semester' | 'gradingPeriod';

export interface SrcSession {
  sourcedId: string;
  title: string;
  type: SessionType;
  startDate: string | null;
  endDate: string | null;
  parentSourcedId: string | null;
  schoolYear: string | null;
}

export type UserKind = 'student' | 'staff';

export interface SrcUser {
  sourcedId: string;
  kind: UserKind;
  givenName: string;
  familyName: string;
  /** Lower-cased. */
  email: string | null;
  /** The school's own number for the person (OneRoster `identifier`). */
  identifier: string | null;
  dateOfBirth: string | null;
  orgSourcedIds: string[];
}

export interface SrcClass {
  sourcedId: string;
  title: string;
  classCode: string | null;
  schoolSourcedId: string;
  termSourcedIds: string[];
}

export type EnrolmentRole = 'student' | 'teacher' | 'ta';

export interface SrcEnrollment {
  sourcedId: string;
  classSourcedId: string;
  userSourcedId: string;
  role: EnrolmentRole;
}

/** A source row that could not be read. */
export interface RowError {
  file: string;
  line: number | null;
  sourcedId: string | null;
  message: string;
}

export type SnapshotPart = 'orgs' | 'sessions' | 'students' | 'staff' | 'classes' | 'enrollments';

export interface RosterSnapshot {
  orgs: SrcOrg[];
  sessions: SrcSession[];
  users: SrcUser[];
  classes: SrcClass[];
  enrollments: SrcEnrollment[];
  errors: RowError[];
  /**
   * Which parts the source actually carried. Records missing from the
   * source are only proposed for disabling for parts it carried: a CSV
   * upload of students alone never disables courses.
   */
  present: SnapshotPart[];
}

export function emptySnapshot(): RosterSnapshot {
  return { orgs: [], sessions: [], users: [], classes: [], enrollments: [], errors: [], present: [] };
}

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/** One row of a dry run's change set (stored as roster_change). */
export interface PlannedChange {
  entity: RosterEntity;
  action: ChangeAction;
  sourcedId: string;
  targetId: string | null;
  schoolId: string | null;
  label: string;
  diff: FieldDiff;
  data: Record<string, unknown>;
  errors: string[];
}

/** Apply order: parents before children; disables last, children first. */
export const APPLY_ORDER: Record<RosterEntity, number> = {
  school: 0,
  academic_year: 1,
  term: 2,
  course: 3,
  student: 4,
  staff: 5,
  enrolment: 6,
  course_staff: 7,
};

export function sortChanges(changes: PlannedChange[]): PlannedChange[] {
  const rank = (c: PlannedChange) =>
    c.action === 'disable' ? 100 - APPLY_ORDER[c.entity] : c.action === 'error' ? 200 : APPLY_ORDER[c.entity];
  return [...changes].sort((a, b) => rank(a) - rank(b));
}

export type ChangeSummary = Record<string, Partial<Record<ChangeAction, number>>>;

export function summarise(changes: PlannedChange[]): ChangeSummary {
  const out: ChangeSummary = {};
  for (const c of changes) {
    const row = (out[c.entity] ??= {});
    row[c.action] = (row[c.action] ?? 0) + 1;
  }
  return out;
}
