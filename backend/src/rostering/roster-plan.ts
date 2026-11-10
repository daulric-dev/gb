/**
 * The dry run: compare a RosterSnapshot with what GradeBook has (RosterState)
 * and produce the change set. Pure, so the matching rules are easy to test;
 * RosterStateService loads the state and RosterApplyService applies the
 * changes.
 *
 * Matching, per record: its link (sourcedId -> GradeBook id, per source)
 * first; without one, students by student number then email (each can be
 * switched off), staff by account email; academic years and terms by name
 * in their school / year. A matched record gets an `update` (possibly with
 * no field changes) so the apply records the link and the next run is
 * quiet. Records whose org is not mapped to a school wait (one error row
 * per org); records that are gone from the source are proposed as
 * `disable` (never delete), only for the parts the source carried.
 */
import type { RosterSettings } from './roster-settings';
import {
  sortChanges,
  type FieldDiff,
  type PlannedChange,
  type RosterEntity,
  type RosterSnapshot,
  type SnapshotPart,
  type SrcSession,
  type SrcUser,
} from './roster-types';

export interface LinkRow {
  entity: RosterEntity;
  sourcedId: string;
  targetId: string;
  schoolId: string | null;
  email: string | null;
  disabled: boolean;
  data: Record<string, unknown>;
}

export interface YearRow { id: string; schoolId: string; name: string; startDate: string | null; endDate: string | null }
export interface TermRow { id: string; academicYearId: string; name: string; startDate: string | null; endDate: string | null }
export interface CourseRow {
  id: string;
  schoolId: string;
  name: string;
  code: string | null;
  termId: string | null;
  academicYearId: string | null;
  status: string;
}
export interface StudentRow {
  id: string;
  schoolId: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  studentNumber: string | null;
  isActive: boolean;
  /** The linked account's email, lower-cased. */
  accountEmail: string | null;
}
export interface AccountRow {
  userId: string;
  email: string;
  accountType: 'staff' | 'student' | 'parent';
  memberships: { schoolId: string; role: string | null }[];
}
export interface InviteRow { id: string; schoolId: string; email: string }
export interface EnrolRow { id: string; courseId: string; studentId: string; status: string }
export interface CourseStaffRow { id: string; courseId: string; userProfileId: string; role: 'teacher' | 'ta' }

export interface RosterState {
  schools: Set<string>;
  links: LinkRow[];
  years: YearRow[];
  terms: TermRow[];
  courses: CourseRow[];
  students: StudentRow[];
  accounts: AccountRow[];
  invites: InviteRow[];
  enrolments: EnrolRow[];
  courseStaff: CourseStaffRow[];
}

export interface PlanResult {
  changes: PlannedChange[];
  /** Course roles waiting for a teacher's first sign-in (added by a later sync). */
  waiting: number;
}

/** The link key of a per-school record (academic years and terms are per school). */
export const schoolKey = (sourcedId: string, schoolId: string) => `${sourcedId}@${schoolId}`;

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const fullName = (u: { givenName: string; familyName: string }) => `${u.givenName} ${u.familyName}`.trim();

function diffOf(pairs: [string, unknown, unknown][]): FieldDiff {
  const out: FieldDiff = {};
  for (const [field, from, to] of pairs) {
    if (to === undefined) continue;
    if ((from ?? null) !== (to ?? null)) out[field] = { from: from ?? null, to: to ?? null };
  }
  return out;
}

const PART_OF: Partial<Record<RosterEntity, SnapshotPart>> = {
  course: 'classes',
  student: 'students',
  staff: 'staff',
  enrolment: 'enrollments',
  course_staff: 'enrollments',
};

export function planRoster(snap: RosterSnapshot, state: RosterState, settings: RosterSettings): PlanResult {
  const changes: PlannedChange[] = [];
  let waiting = 0;

  const links = new Map<string, LinkRow>();
  const linkKey = (entity: RosterEntity, sourcedId: string) => `${entity}\u0000${sourcedId}`;
  for (const l of state.links) links.set(linkKey(l.entity, l.sourcedId), l);
  const link = (entity: RosterEntity, sourcedId: string) => links.get(linkKey(entity, sourcedId));

  const yearsById = new Map(state.years.map((y) => [y.id, y]));
  const termsById = new Map(state.terms.map((t) => [t.id, t]));
  const coursesById = new Map(state.courses.map((c) => [c.id, c]));
  const studentsById = new Map(state.students.map((s) => [s.id, s]));
  const accountsByEmail = new Map(state.accounts.map((a) => [lower(a.email), a]));
  const accountsById = new Map(state.accounts.map((a) => [a.userId, a]));

  const error = (entity: RosterEntity, sourcedId: string, label: string, schoolId: string | null, errors: string[]) =>
    changes.push({ entity, action: 'error', sourcedId, targetId: null, schoolId, label, diff: {}, data: {}, errors });

  // --- orgs -> schools -------------------------------------------------------
  const orgNames = new Map(snap.orgs.map((o) => [o.sourcedId, o.name]));
  const unmapped = new Map<string, number>();
  const schoolOf = (orgId: string): string | null | undefined => {
    if (!(orgId in settings.orgMap)) {
      unmapped.set(orgId, (unmapped.get(orgId) ?? 0) + 1);
      return undefined;
    }
    const school = settings.orgMap[orgId];
    if (school === null) return null; // ignored on purpose
    if (!state.schools.has(school)) {
      unmapped.set(orgId, (unmapped.get(orgId) ?? 0) + 1);
      return undefined;
    }
    return school;
  };
  const userSchool = (u: SrcUser): string | null | undefined => {
    let result: string | null | undefined = undefined;
    for (const org of u.orgSourcedIds) {
      const s = schoolOf(org);
      if (s) return s;
      if (s === null) result = null;
    }
    return result;
  };

  // --- academic years and terms ---------------------------------------------
  const sessions = new Map(snap.sessions.map((s) => [s.sourcedId, s]));
  const yearSessionOf = (s: SrcSession): SrcSession | null => {
    let cur: SrcSession | undefined = s;
    for (let depth = 0; cur && depth < 6; depth++) {
      if (cur.type === 'schoolYear') return cur;
      cur = cur.parentSourcedId ? sessions.get(cur.parentSourcedId) : undefined;
    }
    return null;
  };

  /** Planned or existing target per key, for children planned in the same run. */
  const plannedYears = new Map<string, { exists: string | null; name: string }>();
  const plannedTerms = new Map<string, { exists: string | null; name: string }>();

  const planYear = (yearSession: SrcSession, schoolId: string) => {
    const key = schoolKey(yearSession.sourcedId, schoolId);
    if (plannedYears.has(key)) return;
    const data = { schoolId, name: yearSession.title, startDate: yearSession.startDate, endDate: yearSession.endDate };
    const l = link('academic_year', key);
    let target = l ? yearsById.get(l.targetId) : undefined;
    let matched = false;
    if (!target) {
      target = state.years.find((y) => y.schoolId === schoolId && lower(y.name) === lower(yearSession.title));
      matched = !!target;
    }
    if (target) {
      const diff = diffOf([
        ['name', target.name, yearSession.title],
        ['startDate', target.startDate, yearSession.startDate ?? undefined],
        ['endDate', target.endDate, yearSession.endDate ?? undefined],
      ]);
      if (matched || Object.keys(diff).length) {
        changes.push({ entity: 'academic_year', action: 'update', sourcedId: key, targetId: target.id, schoolId, label: yearSession.title, diff, data, errors: [] });
      }
      plannedYears.set(key, { exists: target.id, name: target.name });
    } else {
      changes.push({
        entity: 'academic_year', action: 'create', sourcedId: key, targetId: null, schoolId, label: yearSession.title,
        diff: diffOf([['name', null, yearSession.title], ['startDate', null, yearSession.startDate], ['endDate', null, yearSession.endDate]]),
        data, errors: [],
      });
      plannedYears.set(key, { exists: null, name: yearSession.title });
    }
  };

  const planTerm = (term: SrcSession, yearSession: SrcSession, schoolId: string) => {
    const key = schoolKey(term.sourcedId, schoolId);
    if (plannedTerms.has(key)) return;
    const yearKey = schoolKey(yearSession.sourcedId, schoolId);
    const year = plannedYears.get(yearKey);
    const data = { schoolId, yearKey, name: term.title, startDate: term.startDate, endDate: term.endDate };
    const l = link('term', key);
    let target = l ? termsById.get(l.targetId) : undefined;
    let matched = false;
    if (!target && year?.exists) {
      target = state.terms.find((t) => t.academicYearId === year.exists && lower(t.name) === lower(term.title));
      matched = !!target;
    }
    if (target) {
      const diff = diffOf([
        ['name', target.name, term.title],
        ['startDate', target.startDate, term.startDate ?? undefined],
        ['endDate', target.endDate, term.endDate ?? undefined],
      ]);
      if (matched || Object.keys(diff).length) {
        changes.push({ entity: 'term', action: 'update', sourcedId: key, targetId: target.id, schoolId, label: `${term.title} (${yearSession.title})`, diff, data, errors: [] });
      }
      plannedTerms.set(key, { exists: target.id, name: target.name });
    } else {
      changes.push({
        entity: 'term', action: 'create', sourcedId: key, targetId: null, schoolId, label: `${term.title} (${yearSession.title})`,
        diff: diffOf([['name', null, term.title], ['startDate', null, term.startDate], ['endDate', null, term.endDate]]),
        data, errors: [],
      });
      plannedTerms.set(key, { exists: null, name: term.title });
    }
  };

  // --- courses ---------------------------------------------------------------
  const classSchool = new Map<string, string>();
  const plannedCourses = new Map<string, string | null>(); // class sourcedId -> existing course id (null = created this run)
  for (const cls of snap.classes) {
    const schoolId = schoolOf(cls.schoolSourcedId);
    if (!schoolId) continue;
    classSchool.set(cls.sourcedId, schoolId);

    let yearKey: string | null = null;
    let termKey: string | null = null;
    let termLabel: string | null = null;
    const problems: string[] = [];
    for (const sid of cls.termSourcedIds) {
      const s = sessions.get(sid);
      if (!s) {
        problems.push(`Session ${sid} is not in the source`);
        continue;
      }
      const year = yearSessionOf(s);
      if (!year) {
        problems.push(`Session "${s.title}" belongs to no school year`);
        continue;
      }
      planYear(year, schoolId);
      yearKey = schoolKey(year.sourcedId, schoolId);
      termLabel = year.title;
      if (s.type !== 'schoolYear') {
        planTerm(s, year, schoolId);
        termKey = schoolKey(s.sourcedId, schoolId);
        termLabel = `${s.title} (${year.title})`;
      }
      break;
    }
    const label = cls.classCode ? `${cls.title} (${cls.classCode})` : cls.title;
    if (problems.length && !yearKey) {
      error('course', cls.sourcedId, label, schoolId, problems);
      continue;
    }
    const data = { schoolId, name: cls.title, code: cls.classCode, yearKey, termKey, label };
    const l = link('course', cls.sourcedId);
    const course = l ? coursesById.get(l.targetId) : undefined;
    if (course) {
      if (course.schoolId !== schoolId) {
        error('course', cls.sourcedId, label, schoolId, ['The class moved to another school; move the course by hand']);
        continue;
      }
      const currentTerm = course.termId ? termsById.get(course.termId) : undefined;
      const currentYear = course.academicYearId ? yearsById.get(course.academicYearId) : undefined;
      const wantTermId = termKey ? (plannedTerms.get(termKey)?.exists ?? 'new') : null;
      const wantYearId = yearKey ? (plannedYears.get(yearKey)?.exists ?? 'new') : null;
      const pairs: [string, unknown, unknown][] = [
        ['name', course.name, cls.title],
        ['code', course.code, cls.classCode],
      ];
      if (wantTermId !== (course.termId ?? null) || (!termKey && wantYearId !== (course.academicYearId ?? null))) {
        pairs.push([
          'term',
          currentTerm ? `${currentTerm.name}` : (currentYear?.name ?? null),
          termLabel,
        ]);
      }
      if (l!.disabled && course.status === 'archived') {
        pairs.push(['status', 'archived', (l!.data.statusBeforeDisable) ?? 'draft']);
      }
      const diff = diffOf(pairs);
      if (Object.keys(diff).length) {
        changes.push({ entity: 'course', action: 'update', sourcedId: cls.sourcedId, targetId: course.id, schoolId, label, diff, data, errors: [] });
      }
      plannedCourses.set(cls.sourcedId, course.id);
    } else {
      changes.push({
        entity: 'course', action: 'create', sourcedId: cls.sourcedId, targetId: null, schoolId, label,
        diff: diffOf([['name', null, cls.title], ['code', null, cls.classCode], ['term', null, termLabel]]),
        data, errors: [],
      });
      plannedCourses.set(cls.sourcedId, null);
    }
  }

  // --- students --------------------------------------------------------------
  const userSchoolMap = new Map<string, string>();
  const plannedStudents = new Map<string, string | null>(); // user sourcedId -> existing student id
  const claimed = new Map<string, string>(); // student id -> user sourcedId that matched it
  const rosterEmails = new Map<string, string>(); // lower email -> student id (from links)
  for (const l of state.links) {
    if (l.entity === 'student' && l.email) rosterEmails.set(lower(l.email), l.targetId);
  }

  for (const u of snap.users.filter((x) => x.kind === 'student')) {
    const schoolId = userSchool(u);
    if (!schoolId) continue;
    userSchoolMap.set(u.sourcedId, schoolId);
    const label = `${u.familyName}, ${u.givenName}`.replace(/^, |, $/g, '');
    const data = {
      schoolId,
      firstName: u.givenName || null,
      lastName: u.familyName || null,
      dateOfBirth: u.dateOfBirth,
      studentNumber: u.identifier,
      email: u.email,
      label,
    };
    const l = link('student', u.sourcedId);
    let target = l ? studentsById.get(l.targetId) : undefined;
    let matchedBy: string | null = null;
    if (!target) {
      const inSchool = state.students.filter((s) => s.schoolId === schoolId);
      if (settings.matchBy.studentNumber && u.identifier) {
        const hits = inSchool.filter((s) => s.studentNumber === u.identifier);
        if (hits.length === 1) {
          target = hits[0];
          matchedBy = 'student number';
        }
      }
      if (!target && settings.matchBy.email && u.email) {
        const hits = inSchool.filter(
          (s) => lower(s.accountEmail) === u.email || rosterEmails.get(u.email!) === s.id,
        );
        if (hits.length > 1) {
          error('student', u.sourcedId, label, schoolId, [`${hits.length} students in the school have the email ${u.email}`]);
          continue;
        }
        if (hits.length === 1) {
          target = hits[0];
          matchedBy = 'email';
        }
      }
    }
    if (target) {
      if (target.schoolId !== schoolId) {
        error('student', u.sourcedId, label, schoolId, ['The student moved to another school; move them by hand']);
        continue;
      }
      const other = claimed.get(target.id);
      if (other) {
        error('student', u.sourcedId, label, schoolId, [`Matches the same student as source record ${other}`]);
        continue;
      }
      claimed.set(target.id, u.sourcedId);
      const numberTaken =
        u.identifier &&
        u.identifier !== target.studentNumber &&
        state.students.some((s) => s.schoolId === schoolId && s.id !== target.id && s.studentNumber === u.identifier);
      if (numberTaken) {
        error('student', u.sourcedId, label, schoolId, [`Student number ${u.identifier} belongs to another student`]);
        continue;
      }
      const diff = diffOf([
        ['firstName', target.firstName, u.givenName || undefined],
        ['lastName', target.lastName, u.familyName || undefined],
        ['dateOfBirth', target.dateOfBirth, u.dateOfBirth ?? undefined],
        ['studentNumber', target.studentNumber, u.identifier ?? undefined],
        ['email', l?.email ?? null, u.email],
        ['isActive', target.isActive, l?.disabled && !target.isActive ? true : undefined],
      ]);
      if (matchedBy || Object.keys(diff).length) {
        changes.push({
          entity: 'student', action: 'update', sourcedId: u.sourcedId, targetId: target.id, schoolId, label, diff,
          data: { ...data, ...(matchedBy ? { matchedBy } : {}) }, errors: [],
        });
      }
      plannedStudents.set(u.sourcedId, target.id);
    } else {
      if (
        u.identifier &&
        state.students.some((s) => s.schoolId === schoolId && s.studentNumber === u.identifier)
      ) {
        error('student', u.sourcedId, label, schoolId, [
          `Student number ${u.identifier} belongs to another student (matching by student number is off)`,
        ]);
        continue;
      }
      changes.push({
        entity: 'student', action: 'create', sourcedId: u.sourcedId, targetId: null, schoolId, label,
        diff: diffOf([
          ['firstName', null, u.givenName || null],
          ['lastName', null, u.familyName || null],
          ['dateOfBirth', null, u.dateOfBirth],
          ['studentNumber', null, u.identifier],
          ['email', null, u.email],
        ]),
        data, errors: [],
      });
      plannedStudents.set(u.sourcedId, null);
    }
  }

  // --- staff -----------------------------------------------------------------
  /** user sourcedId -> account id when known (null: invited, waiting for sign-in). */
  const plannedStaff = new Map<string, string | null>();
  for (const u of snap.users.filter((x) => x.kind === 'staff')) {
    const schoolId = userSchool(u);
    if (!schoolId) continue;
    userSchoolMap.set(u.sourcedId, schoolId);
    const label = fullName(u) || u.email || u.sourcedId;
    if (!u.email) {
      error('staff', u.sourcedId, label, schoolId, ['Staff need an email address to be invited']);
      continue;
    }
    const account = accountsByEmail.get(u.email);
    const l = link('staff', u.sourcedId);
    const data = { schoolId, email: u.email, firstName: u.givenName, lastName: u.familyName, label };
    if (account && account.accountType !== 'staff') {
      error('staff', u.sourcedId, label, schoolId, [`${u.email} is a ${account.accountType} account and cannot be staff`]);
      continue;
    }
    const member = account?.memberships.some((m) => m.schoolId === schoolId) ?? false;
    if (l && !l.disabled && (l.targetId === account?.userId || (!account && l.data.pending))) {
      // Linked and unchanged (an account still, or still waiting for sign-in).
      if (lower(l.email) !== u.email) {
        changes.push({ entity: 'staff', action: 'update', sourcedId: u.sourcedId, targetId: l.targetId, schoolId, label, diff: { email: { from: l.email, to: u.email } }, data: { ...data, mode: account ? 'link' : 'invite' }, errors: [] });
      }
      plannedStaff.set(u.sourcedId, account?.userId ?? null);
      continue;
    }
    if (account) {
      if (member && !l?.disabled) {
        changes.push({
          entity: 'staff', action: 'update', sourcedId: u.sourcedId, targetId: account.userId, schoolId, label,
          diff: l?.data.pending ? { account: { from: 'invited', to: 'signed in' } } : {},
          data: { ...data, mode: 'link', userId: account.userId, ...(l ? {} : { matchedBy: 'email' }) }, errors: [],
        });
      } else {
        changes.push({
          entity: 'staff', action: l ? 'update' : 'create', sourcedId: u.sourcedId, targetId: account.userId, schoolId, label,
          diff: { membership: { from: null, to: 'teacher' } },
          data: { ...data, mode: 'membership', userId: account.userId }, errors: [],
        });
      }
      plannedStaff.set(u.sourcedId, account.userId);
    } else {
      const invite = state.invites.find((i) => i.schoolId === schoolId && lower(i.email) === u.email);
      if (invite) {
        changes.push({
          entity: 'staff', action: 'update', sourcedId: u.sourcedId, targetId: invite.id, schoolId, label,
          diff: {}, data: { ...data, mode: 'invite-existing', inviteId: invite.id }, errors: [],
        });
      } else {
        changes.push({
          entity: 'staff', action: l ? 'update' : 'create', sourcedId: u.sourcedId, targetId: null, schoolId, label,
          diff: { invite: { from: null, to: u.email } }, data: { ...data, mode: 'invite' }, errors: [],
        });
      }
      plannedStaff.set(u.sourcedId, null);
    }
  }

  // --- enrolments and course roles -------------------------------------------
  const usersById = new Map(snap.users.map((u) => [u.sourcedId, u]));
  const classesById = new Map(snap.classes.map((c) => [c.sourcedId, c]));
  const enrolByPair = new Map(state.enrolments.map((e) => [`${e.courseId}:${e.studentId}`, e]));
  const staffByPair = new Map(state.courseStaff.map((e) => [`${e.courseId}:${e.userProfileId}`, e]));
  const enrolById = new Map(state.enrolments.map((e) => [e.id, e]));
  const staffRowById = new Map(state.courseStaff.map((e) => [e.id, e]));

  for (const e of snap.enrollments) {
    const cls = classesById.get(e.classSourcedId);
    const user = usersById.get(e.userSourcedId);
    const entity: RosterEntity = e.role === 'student' ? 'enrolment' : 'course_staff';
    const courseSchool = classSchool.get(e.classSourcedId);
    if (!cls || !user) {
      const label = `${user ? fullName(user) : e.userSourcedId} in ${cls?.title ?? e.classSourcedId}`;
      // Unmapped-org records are reported per org; only real gaps are errors.
      if ((cls && !courseSchool) || (user && !userSchoolMap.has(user.sourcedId))) continue;
      error(entity, e.sourcedId, label, courseSchool ?? null, [
        !cls ? `Class ${e.classSourcedId} is not in the source` : `Person ${e.userSourcedId} is not in the source`,
      ]);
      continue;
    }
    if (!courseSchool || !userSchoolMap.has(user.sourcedId) || !plannedCourses.has(cls.sourcedId)) continue;
    const label = `${fullName(user)} in ${cls.title}`;
    if (userSchoolMap.get(user.sourcedId) !== courseSchool) {
      error(entity, e.sourcedId, label, courseSchool, ['The person and the class are in different schools']);
      continue;
    }
    const courseId = plannedCourses.get(cls.sourcedId) ?? null;
    const data = { schoolId: courseSchool, classSourcedId: cls.sourcedId, userSourcedId: user.sourcedId, role: e.role, label };
    const l = link(entity, e.sourcedId);

    if (entity === 'enrolment') {
      if (user.kind !== 'student') {
        error(entity, e.sourcedId, label, courseSchool, ['A student enrolment for someone who is not a student']);
        continue;
      }
      if (!plannedStudents.has(user.sourcedId)) continue; // the student had an error row
      const studentId = plannedStudents.get(user.sourcedId) ?? null;
      const row = l ? enrolById.get(l.targetId) : courseId && studentId ? enrolByPair.get(`${courseId}:${studentId}`) : undefined;
      if (row) {
        const reactivate = row.status !== 'active' && (!l || l.disabled);
        if (!l || reactivate) {
          changes.push({
            entity, action: 'update', sourcedId: e.sourcedId, targetId: row.id, schoolId: courseSchool, label,
            diff: reactivate ? { status: { from: row.status, to: 'active' } } : {}, data, errors: [],
          });
        }
      } else {
        changes.push({ entity, action: 'create', sourcedId: e.sourcedId, targetId: null, schoolId: courseSchool, label, diff: { status: { from: null, to: 'active' } }, data, errors: [] });
      }
    } else {
      if (user.kind !== 'staff') {
        error(entity, e.sourcedId, label, courseSchool, ['A teacher enrolment for someone who is not staff']);
        continue;
      }
      if (!plannedStaff.has(user.sourcedId)) continue; // the staff member had an error row
      const userId = plannedStaff.get(user.sourcedId) ?? null;
      if (!userId) {
        waiting++;
        continue;
      }
      const row = l ? staffRowById.get(l.targetId) : courseId ? staffByPair.get(`${courseId}:${userId}`) : undefined;
      if (row) {
        const diff = diffOf([['role', row.role, e.role]]);
        if (!l || Object.keys(diff).length) {
          changes.push({ entity, action: 'update', sourcedId: e.sourcedId, targetId: row.id, schoolId: courseSchool, label, diff, data: { ...data, userId }, errors: [] });
        }
      } else {
        changes.push({ entity, action: 'create', sourcedId: e.sourcedId, targetId: null, schoolId: courseSchool, label, diff: { role: { from: null, to: e.role } }, data: { ...data, userId }, errors: [] });
      }
    }
  }

  // --- unmapped orgs ---------------------------------------------------------
  for (const [orgId, count] of unmapped) {
    const mapped = settings.orgMap[orgId];
    error('school', orgId, orgNames.get(orgId) ?? orgId, null, [
      mapped
        ? `Mapped to a school that no longer exists; choose another (${count} record${count === 1 ? '' : 's'} wait)`
        : `Not mapped to a GradeBook school yet: choose one in the source settings (${count} record${count === 1 ? '' : 's'} wait)`,
    ]);
  }

  // --- disables: linked records gone from the source -------------------------
  const inSource: Record<string, Set<string>> = {
    course: new Set(snap.classes.map((c) => c.sourcedId)),
    student: new Set(snap.users.filter((u) => u.kind === 'student').map((u) => u.sourcedId)),
    staff: new Set(snap.users.filter((u) => u.kind === 'staff').map((u) => u.sourcedId)),
    enrolment: new Set(snap.enrollments.filter((e) => e.role === 'student').map((e) => e.sourcedId)),
    course_staff: new Set(snap.enrollments.filter((e) => e.role !== 'student').map((e) => e.sourcedId)),
  };
  for (const l of state.links) {
    const part = PART_OF[l.entity];
    if (!part || l.disabled || !snap.present.includes(part)) continue;
    if (inSource[l.entity].has(l.sourcedId)) continue;
    const label = typeof l.data.label === 'string' ? l.data.label : l.sourcedId;
    let diff: FieldDiff | null = null;
    if (l.entity === 'course') {
      const c = coursesById.get(l.targetId);
      if (c && c.status !== 'archived') diff = { status: { from: c.status, to: 'archived' } };
    } else if (l.entity === 'student') {
      const s = studentsById.get(l.targetId);
      if (s && s.isActive) diff = { isActive: { from: true, to: false } };
    } else if (l.entity === 'staff') {
      const account = accountsById.get(l.targetId);
      if (l.data.pending) {
        if (state.invites.some((i) => i.id === l.targetId)) diff = { invite: { from: l.email, to: 'revoked' } };
      } else if (account) {
        diff = { courseRoles: { from: 'rostered', to: 'removed with their enrolments' } };
      }
    } else if (l.entity === 'enrolment') {
      const row = enrolById.get(l.targetId);
      if (row && row.status === 'active') diff = { status: { from: 'active', to: 'dropped' } };
    } else if (l.entity === 'course_staff') {
      const row = staffRowById.get(l.targetId);
      if (row) diff = { role: { from: row.role, to: null } };
    }
    if (!diff) continue;
    changes.push({
      entity: l.entity, action: 'disable', sourcedId: l.sourcedId, targetId: l.targetId, schoolId: l.schoolId, label,
      diff, data: { schoolId: l.schoolId, label }, errors: [],
    });
  }

  for (const e of snap.errors) {
    changes.push({
      entity: errorEntity(e.file), action: 'error', sourcedId: e.sourcedId ?? `${e.file}:${e.line ?? '-'}`,
      targetId: null, schoolId: null, label: e.line ? `${e.file}, line ${e.line}` : e.file, diff: {}, data: {}, errors: [e.message],
    });
  }

  return { changes: sortChanges(changes), waiting };
}

function errorEntity(file: string): RosterEntity {
  const f = file.toLowerCase();
  if (f.includes('org')) return 'school';
  if (f.includes('session')) return 'term';
  if (f.includes('class')) return 'course';
  if (f.includes('enrol')) return 'enrolment';
  if (f.includes('staff')) return 'staff';
  return 'student';
}
