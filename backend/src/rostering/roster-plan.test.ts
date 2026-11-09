import { describe, expect, test } from 'bun:test';
import { planRoster, type RosterState } from './roster-plan';
import { readSettings, type RosterSettings } from './roster-settings';
import { parseOneRosterCsv } from './roster-csv';
import type { PlannedChange, RosterSnapshot } from './roster-types';
import { BUNDLE_12 } from '@/test/roster-fixtures';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const asMap = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));

function emptyState(): RosterState {
  return {
    schools: new Set([SCHOOL, OTHER]),
    links: [],
    years: [],
    terms: [],
    courses: [],
    students: [],
    accounts: [],
    invites: [],
    enrolments: [],
    courseStaff: [],
  };
}

const settings = (patch: Partial<RosterSettings> = {}): RosterSettings => ({
  ...readSettings({}),
  orgMap: { 'org-1': SCHOOL },
  ...patch,
});

let ids = 0;
const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

/**
 * Applies a change set to the in-memory state the way RosterApplyService
 * does to the database (links included), so a second plan can be compared.
 */
function applyToState(state: RosterState, changes: PlannedChange[], includeDisables = true) {
  const linkOf = (entity: string, sourcedId: string) =>
    state.links.find((l) => l.entity === entity && l.sourcedId === sourcedId);
  const setLink = (c: PlannedChange, targetId: string, extra: { email?: string | null; data?: Record<string, unknown> } = {}) => {
    const existing = linkOf(c.entity, c.sourcedId);
    if (existing) {
      Object.assign(existing, { targetId, disabled: false, schoolId: c.schoolId, data: { ...existing.data, ...extra.data } });
      if (extra.email !== undefined) existing.email = extra.email;
    } else {
      state.links.push({ entity: c.entity, sourcedId: c.sourcedId, targetId, schoolId: c.schoolId, email: extra.email ?? null, disabled: false, data: { label: c.label, ...extra.data } });
    }
  };
  for (const c of changes) {
    const d = c.data as Record<string, any>;
    if (c.action === 'error') continue;
    if (c.action === 'disable') {
      if (!includeDisables) continue;
      const l = linkOf(c.entity, c.sourcedId)!;
      l.disabled = true;
      if (c.entity === 'student') state.students.find((s) => s.id === c.targetId)!.isActive = false;
      if (c.entity === 'course') {
        const course = state.courses.find((x) => x.id === c.targetId)!;
        l.data.statusBeforeDisable = course.status;
        course.status = 'archived';
      }
      if (c.entity === 'enrolment') state.enrolments.find((e) => e.id === c.targetId)!.status = 'dropped';
      if (c.entity === 'course_staff') state.courseStaff = state.courseStaff.filter((e) => e.id !== c.targetId);
      if (c.entity === 'staff') state.invites = state.invites.filter((i) => i.id !== c.targetId);
      continue;
    }
    switch (c.entity) {
      case 'academic_year': {
        let y = state.years.find((x) => x.id === c.targetId);
        if (!y) state.years.push((y = { id: id(), schoolId: d.schoolId, name: d.name, startDate: null, endDate: null }));
        Object.assign(y, { name: d.name, startDate: d.startDate ?? y.startDate, endDate: d.endDate ?? y.endDate });
        setLink(c, y.id);
        break;
      }
      case 'term': {
        const yearId = linkOf('academic_year', d.yearKey)!.targetId;
        let t = state.terms.find((x) => x.id === c.targetId);
        if (!t) state.terms.push((t = { id: id(), academicYearId: yearId, name: d.name, startDate: null, endDate: null }));
        Object.assign(t, { name: d.name, startDate: d.startDate ?? t.startDate, endDate: d.endDate ?? t.endDate });
        setLink(c, t.id);
        break;
      }
      case 'course': {
        const yearId = d.yearKey ? linkOf('academic_year', d.yearKey)!.targetId : null;
        const termId = d.termKey ? linkOf('term', d.termKey)!.targetId : null;
        let course = state.courses.find((x) => x.id === c.targetId);
        if (!course) state.courses.push((course = { id: id(), schoolId: d.schoolId, name: '', code: null, termId: null, academicYearId: null, status: 'draft' }));
        Object.assign(course, { name: d.name, code: d.code, termId, academicYearId: yearId });
        if (c.diff.status) course.status = c.diff.status.to as string;
        setLink(c, course.id);
        break;
      }
      case 'student': {
        let s = state.students.find((x) => x.id === c.targetId);
        if (!s) state.students.push((s = { id: id(), schoolId: d.schoolId, firstName: null, lastName: null, dateOfBirth: null, studentNumber: null, isActive: true, accountEmail: null }));
        for (const [field, change] of Object.entries(c.diff)) {
          if (field in s) (s as any)[field] = change.to;
        }
        setLink(c, s.id, { email: d.email });
        break;
      }
      case 'staff': {
        if (d.mode === 'invite') {
          const invite = { id: id(), schoolId: d.schoolId, email: d.email };
          state.invites.push(invite);
          setLink(c, invite.id, { email: d.email, data: { pending: true } });
        } else if (d.mode === 'invite-existing') {
          setLink(c, d.inviteId, { email: d.email, data: { pending: true } });
        } else {
          const account = state.accounts.find((a) => a.userId === (d.userId ?? c.targetId))!;
          if (!account.memberships.some((m) => m.schoolId === d.schoolId)) account.memberships.push({ schoolId: d.schoolId, role: 'teacher' });
          setLink(c, account.userId, { email: d.email, data: { pending: false } });
        }
        break;
      }
      case 'enrolment': {
        const courseId = linkOf('course', d.classSourcedId)!.targetId;
        const studentId = linkOf('student', d.userSourcedId)!.targetId;
        let e = state.enrolments.find((x) => x.courseId === courseId && x.studentId === studentId);
        if (!e) state.enrolments.push((e = { id: id(), courseId, studentId, status: 'active' }));
        e.status = 'active';
        setLink(c, e.id);
        break;
      }
      case 'course_staff': {
        const courseId = linkOf('course', d.classSourcedId)!.targetId;
        let e = state.courseStaff.find((x) => x.courseId === courseId && x.userProfileId === d.userId);
        if (!e) state.courseStaff.push((e = { id: id(), courseId, userProfileId: d.userId, role: d.role }));
        e.role = d.role;
        setLink(c, e.id);
        break;
      }
    }
  }
}

const actionable = (changes: PlannedChange[]) => changes.filter((c) => c.action !== 'error');
const brief = (changes: PlannedChange[]) => changes.map((c) => `${c.action} ${c.entity} ${c.sourcedId}`);

describe('planRoster', () => {
  const snap = () => parseOneRosterCsv(asMap(BUNDLE_12));

  test('a first sync creates every record in parent-first order', () => {
    const { changes } = planRoster(snap(), emptyState(), settings());
    expect(brief(actionable(changes))).toEqual([
      `create academic_year y26@${SCHOOL}`,
      `create term t1@${SCHOOL}`,
      'create course c-1',
      'create student u-s1',
      'create student u-s2',
      'create staff u-t1',
      'create enrolment e-1',
      'create enrolment e-2',
    ]);
    const student = changes.find((c) => c.sourcedId === 'u-s1')!;
    expect(student.diff).toMatchObject({ firstName: { from: null, to: 'Jordan' }, studentNumber: { from: null, to: '1001' } });
    // The teacher has no account yet: invited, and their course role waits.
    expect(changes.find((c) => c.entity === 'staff')!.data.mode).toBe('invite');
    // Malformed source rows travel as error rows.
    expect(changes.filter((c) => c.action === 'error').length).toBe(3);
  });

  test('mapping idempotency: applying then re-running changes nothing', () => {
    const state = emptyState();
    const first = planRoster(snap(), state, settings());
    applyToState(state, first.changes);
    const second = planRoster(snap(), state, settings());
    expect(actionable(second.changes)).toEqual([]);
    expect(second.waiting).toBe(1); // the invited teacher's course role
    // Re-run again, still nothing; nothing was duplicated.
    applyToState(state, second.changes);
    expect(actionable(planRoster(snap(), state, settings()).changes)).toEqual([]);
    expect(state.students.length).toBe(2);
    expect(state.courses.length).toBe(1);
  });

  test('a teacher who signs in later gets linked, then their course role is added', () => {
    const state = emptyState();
    applyToState(state, planRoster(snap(), state, settings()).changes);
    state.accounts.push({ userId: 'u-ada', email: 'ada@school.org', accountType: 'staff', memberships: [{ schoolId: SCHOOL, role: 'teacher' }] });
    const next = planRoster(snap(), state, settings());
    expect(brief(actionable(next.changes))).toEqual(['update staff u-t1', 'create course_staff e-3']);
    expect(next.changes[0].diff).toEqual({ account: { from: 'invited', to: 'signed in' } });
    applyToState(state, next.changes);
    expect(actionable(planRoster(snap(), state, settings()).changes)).toEqual([]);
  });

  test('a source change becomes an update with a field diff', () => {
    const state = emptyState();
    applyToState(state, planRoster(snap(), state, settings()).changes);
    const changed = snap();
    changed.users[0].familyName = 'Rivera-Smith';
    changed.classes[0].title = 'Maths 7A';
    const { changes } = planRoster(changed, state, settings());
    expect(brief(actionable(changes))).toEqual(['update course c-1', 'update student u-s1']);
    expect(changes.find((c) => c.entity === 'student')!.diff).toEqual({ lastName: { from: 'Rivera', to: 'Rivera-Smith' } });
  });

  test('matches an existing student by email when there is no link (fallback after student number)', () => {
    const state = emptyState();
    state.students.push({ id: 'st-1', schoolId: SCHOOL, firstName: 'Jordan', lastName: 'Rivera', dateOfBirth: null, studentNumber: null, isActive: true, accountEmail: 'jordan.rivera@school.org' });
    const { changes } = planRoster(snap(), state, settings());
    const jordan = changes.find((c) => c.sourcedId === 'u-s1')!;
    expect(jordan).toMatchObject({ action: 'update', targetId: 'st-1', data: { matchedBy: 'email' } });
    expect(jordan.diff).toEqual({
      dateOfBirth: { from: null, to: '2012-04-30' },
      studentNumber: { from: null, to: '1001' },
      email: { from: null, to: 'jordan.rivera@school.org' },
    });
    expect(changes.filter((c) => c.entity === 'student' && c.action === 'create').map((c) => c.sourcedId)).toEqual(['u-s2']);
  });

  test('matches by student number first; matching can be switched off', () => {
    const state = emptyState();
    state.students.push({ id: 'st-9', schoolId: SCHOOL, firstName: 'J', lastName: 'R', dateOfBirth: null, studentNumber: '1001', isActive: true, accountEmail: null });
    expect(planRoster(snap(), state, settings()).changes.find((c) => c.sourcedId === 'u-s1')).toMatchObject({ action: 'update', targetId: 'st-9', data: { matchedBy: 'student number' } });

    const off = planRoster(snap(), state, settings({ matchBy: { email: false, studentNumber: false } }));
    // Not matched, and the number is taken: an error, never a duplicate number.
    expect(off.changes.find((c) => c.sourcedId === 'u-s1')).toMatchObject({ action: 'error' });
  });

  test('staff with an existing account become members (never admins); a student account is refused', () => {
    const state = emptyState();
    state.accounts.push({ userId: 'u-ada', email: 'ada@school.org', accountType: 'staff', memberships: [] });
    const c = planRoster(snap(), state, settings()).changes.find((x) => x.entity === 'staff')!;
    expect(c).toMatchObject({ action: 'create', data: { mode: 'membership', userId: 'u-ada' }, diff: { membership: { from: null, to: 'teacher' } } });

    state.accounts[0].accountType = 'student';
    expect(planRoster(snap(), state, settings()).changes.find((x) => x.entity === 'staff')).toMatchObject({ action: 'error' });
  });

  test('records missing from the source are proposed as disables, never deletes', () => {
    const state = emptyState();
    applyToState(state, planRoster(snap(), state, settings()).changes);
    const smaller = snap();
    smaller.users = smaller.users.filter((u) => u.sourcedId !== 'u-s2');
    smaller.enrollments = smaller.enrollments.filter((e) => e.sourcedId !== 'e-2');
    const { changes } = planRoster(smaller, state, settings());
    expect(brief(changes.filter((c) => c.action === 'disable'))).toEqual(['disable enrolment e-2', 'disable student u-s2']);
    expect(changes.find((c) => c.entity === 'student' && c.action === 'disable')!.diff).toEqual({ isActive: { from: true, to: false } });

    // Without confirming disables the student stays active and the next run lists them again.
    applyToState(state, changes, false);
    expect(brief(planRoster(smaller, state, settings()).changes.filter((c) => c.action === 'disable'))).toEqual([
      'disable enrolment e-2',
      'disable student u-s2',
    ]);
    // Confirmed: applied once, then quiet; back in the source re-activates.
    applyToState(state, changes, true);
    expect(actionable(planRoster(smaller, state, settings()).changes)).toEqual([]);
    const back = planRoster(snap(), state, settings()).changes;
    expect(back.find((c) => c.sourcedId === 'u-s2')!.diff).toEqual({ isActive: { from: false, to: true } });
  });

  test('a partial upload only disables what it carried', () => {
    const state = emptyState();
    applyToState(state, planRoster(snap(), state, settings()).changes);
    const onlyClasses: RosterSnapshot = { ...snap(), users: [], enrollments: [], present: ['orgs', 'sessions', 'classes'] };
    expect(planRoster(onlyClasses, state, settings()).changes.filter((c) => c.action === 'disable')).toEqual([]);
  });

  test('an unmapped org waits with one error row; an ignored one is silent', () => {
    const unmapped = planRoster(snap(), emptyState(), settings({ orgMap: {} }));
    const orgErrors = unmapped.changes.filter((c) => c.entity === 'school');
    expect(orgErrors).toHaveLength(1);
    expect(orgErrors[0]).toMatchObject({ sourcedId: 'org-1', label: 'North High' });
    expect(orgErrors[0].errors[0]).toContain('Not mapped');
    expect(actionable(unmapped.changes)).toEqual([]);

    const ignored = planRoster(snap(), emptyState(), settings({ orgMap: { 'org-1': null } }));
    expect(ignored.changes.filter((c) => c.entity === 'school')).toEqual([]);
    expect(actionable(ignored.changes)).toEqual([]);
  });

  test('existing academic years and terms are matched by name, not duplicated', () => {
    const state = emptyState();
    state.years.push({ id: 'y-old', schoolId: SCHOOL, name: '2026-2027', startDate: '2026-09-01', endDate: '2027-07-15' });
    state.terms.push({ id: 't-old', academicYearId: 'y-old', name: 'term 1', startDate: '2026-09-01', endDate: '2026-12-18' });
    const { changes } = planRoster(snap(), state, settings());
    expect(changes.find((c) => c.entity === 'academic_year')).toMatchObject({ action: 'update', targetId: 'y-old', diff: {} });
    expect(changes.find((c) => c.entity === 'term')).toMatchObject({ action: 'update', targetId: 't-old', diff: { name: { from: 'term 1', to: 'Term 1' } } });
  });
});
