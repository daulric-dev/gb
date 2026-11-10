import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { ParentPortalService } from './parent-portal.service';
import { toParentWork, workState } from './parent-portal.mapper';
import {
  excludedByAge,
  mergeParentSettings,
  parseParentSettings,
  DEFAULT_PARENT_SETTINGS,
} from './parent-settings';
import { FeatureService } from '@/features/feature.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const ctx = { studentId: 'stu-1', schoolId: 'school-1' };

/** Keys a parent must never receive, at any depth. */
const TEACHER_ONLY = [
  'feedback',
  'instructions',
  'lockdownBrowser',
  'isAway',
  'is_away',
  'latitude',
  'longitude',
  'accuracy_m',
  'accuracyM',
  'distance_m',
  'location_flags',
  'locationFlags',
  'note',
  'answers',
  'text_response',
  'textResponse',
  'files',
  'accommodation',
  'timeMultiplier',
  'lockdownExempt',
  'omitFromFinalGrade',
  'attemptCount',
];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

function expectNoTeacherOnly(value: unknown) {
  const keys = keysDeep(value);
  for (const k of TEACHER_ONLY) expect(keys.has(k)).toBe(false);
}

/** A student-portal grades payload with everything a student sees. */
const STUDENT_GRADES = {
  grade: {
    percent: 88,
    letter: 'B+',
    groups: [{ groupId: 'g1', name: 'Tests', weight: 50, earned: 8, possible: 10, percent: 80, dropped: [] }],
    dropped: [],
  },
  groups: [{ id: 'g1', name: 'Tests' }],
  activities: [
    {
      id: 'a1',
      courseId: 'c1',
      title: 'Quiz 1',
      kind: 'quiz',
      instructions: 'secret-ish instructions',
      points: 10,
      dueAt: '2026-11-01T10:00:00.000Z',
      lockdownBrowser: true,
      timeLimitMinutes: 30,
      groupName: 'Tests',
      dropped: false,
      submission: { status: 'graded', score: 8, excused: false, attemptCount: 1, submittedAt: 'x', feedback: 'Good work' },
    },
    {
      id: 'a2',
      title: 'Essay',
      kind: 'assignment',
      points: 20,
      dueAt: null,
      groupName: null,
      dropped: false,
      submission: { status: 'submitted', score: 15, excused: false, feedback: null },
    },
  ],
};

describe('ParentPortalService', () => {
  let prisma: MockPrisma;
  let gradebook: any;
  let submissions: any;
  let announcements: any;
  let service: ParentPortalService;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: { parent_portal: true } });
    prisma.school.findUnique.mockResolvedValue({ parent_settings: {}, disabled_features: [] });
    prisma.course_student.findMany.mockResolvedValue([{ course_id: 'c1' }]);
    prisma.course.findMany.mockResolvedValue([{ id: 'c1', name: 'Maths', code: 'M1', status: 'published' }]);
    gradebook = {
      studentSummary: mock(async () => ({ percent: 88, letter: 'B+', groups: [], dropped: [] })),
      studentGrades: mock(async () => STUDENT_GRADES),
    };
    submissions = { listForStudent: mock(async () => []) };
    announcements = {
      findForStudent: mock(async () => [
        {
          id: 'n1',
          course_id: 'c1',
          title: 'Trip',
          body: 'Bring lunch',
          created_at: '2026-11-01T00:00:00.000Z',
          updated_at: null,
          author: { first_name: 'T', last_name: 'Eacher', avatar_url: 'x' },
        },
      ]),
      findEveryoneForSchool: mock(async () => [] as any[]),
    };
    const features = new FeatureService(prisma as any, createMockCacheService() as any);
    service = new ParentPortalService(prisma as any, features, gradebook, submissions, announcements);
  });

  test('course grades keep totals and marked scores, never feedback or staff fields', async () => {
    const res = await service.courseGrades(ctx, 'c1');
    expect(gradebook.studentGrades).toHaveBeenCalledWith('stu-1', 'c1');
    expect(res.grade.percent).toBe(88);
    expect(res.activities[0]).toMatchObject({ id: 'a1', status: 'graded', score: 8 });
    // Handed in but not marked: no score yet, as for the student.
    expect(res.activities[1]).toMatchObject({ status: 'submitted', score: null });
    expectNoTeacherOnly(res);
  });

  test('the school hiding grades makes the grades route 403 and drops grades from courses', async () => {
    prisma.school.findUnique.mockResolvedValue({
      parent_settings: { showGrades: false },
      disabled_features: [],
    });
    const err: any = await expectRejection(service.courseGrades(ctx, 'c1'));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe('PARENT_VIEW_HIDDEN');
    expect(gradebook.studentGrades).not.toHaveBeenCalled();

    const courses = await service.courses(ctx);
    expect(courses[0].grade).toBeNull();
    expect(gradebook.studentSummary).not.toHaveBeenCalled();
  });

  test('hiding grades also hides scores in the work list', async () => {
    prisma.school.findUnique.mockResolvedValue({ parent_settings: { showGrades: false }, disabled_features: [] });
    submissions.listForStudent.mockResolvedValue([
      {
        id: 'a1', courseId: 'c1', courseName: 'Maths', kind: 'quiz', title: 'Q', points: 10,
        effectiveDueAt: '2020-01-01T00:00:00.000Z', hasExtension: false, instructions: 'x',
        submission: { status: 'graded', score: 9, excused: false, submittedAt: '2019-12-31T00:00:00.000Z' },
      },
    ]);
    const res = await service.work(ctx);
    expect(res.done[0].score).toBeNull();
    expectNoTeacherOnly(res);
  });

  test('courses carry the grade and teachers by name only', async () => {
    prisma.course_staff.findMany.mockResolvedValue([
      { course_id: 'c1', user_profile: { first_name: 'Ann', last_name: 'T' } },
    ]);
    const res = await service.courses(ctx);
    expect(res).toEqual([
      {
        id: 'c1',
        name: 'Maths',
        code: 'M1',
        status: 'published',
        teachers: [{ firstName: 'Ann', lastName: 'T' }],
        grade: { percent: 88, letter: 'B+' },
      },
    ]);
  });

  test('attendance selects no location data and returns none', async () => {
    prisma.course_attendance_record.findMany.mockResolvedValue([
      {
        course_id: 'c1',
        status: 'absent',
        checked_in_at: null,
        attendance_session: { id: 's1', title: 'Mon', opened_at: new Date('2026-11-02T09:00:00Z') },
      },
    ]);
    const res = await service.attendance(ctx);
    const select = prisma.course_attendance_record.findMany.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(['attendance_session', 'checked_in_at', 'course_id', 'status']);
    expect(Object.keys(select.attendance_session.select).sort()).toEqual(['id', 'opened_at', 'title']);
    expect(prisma.course_attendance_record.findMany.mock.calls[0][0].where.student_id).toBe('stu-1');
    expect(res.courses[0].records[0]).toEqual({
      sessionId: 's1',
      title: 'Mon',
      openedAt: '2026-11-02T09:00:00.000Z',
      status: 'absent',
      checkedInAt: null,
    });
    expect(res.summary.absent).toBe(1);
    expectNoTeacherOnly(res);
  });

  test('the school hiding attendance or announcements is a 403', async () => {
    prisma.school.findUnique.mockResolvedValue({
      parent_settings: { showAttendance: false, showAnnouncements: false, showWork: false },
      disabled_features: [],
    });
    for (const p of [service.attendance(ctx), service.announcementsFor(ctx), service.work(ctx)]) {
      const err: any = await expectRejection(p);
      expect(err.getResponse().code).toBe('PARENT_VIEW_HIDDEN');
    }
  });

  test('announcements: course posts with author names only', async () => {
    const res = await service.announcementsFor(ctx);
    expect(res).toEqual([
      {
        id: 'n1',
        scope: 'course',
        courseId: 'c1',
        courseName: 'Maths',
        schoolName: null,
        title: 'Trip',
        body: 'Bring lunch',
        createdAt: '2026-11-01T00:00:00.000Z',
        author: { firstName: 'T', lastName: 'Eacher' },
      },
    ]);
  });

  test("announcements: the child's school's posts for everyone, merged newest first", async () => {
    prisma.school.findUnique.mockResolvedValue({
      name: 'Hill School',
      parent_settings: {},
      disabled_features: [],
    });
    announcements.findEveryoneForSchool.mockResolvedValue([
      {
        id: 's1',
        title: 'Sports day',
        body: 'Friday',
        created_at: '2026-11-03T00:00:00.000Z',
        updated_at: null,
        author: { first_name: 'H', last_name: 'Ead', avatar_url: 'x' },
      },
    ]);
    const res = await service.announcementsFor(ctx);
    // Only ever the child's own school (from ParentGuard), never another.
    expect(announcements.findEveryoneForSchool).toHaveBeenCalledWith('school-1');
    expect(res.map((r) => r.id)).toEqual(['s1', 'n1']);
    expect(res[0]).toEqual({
      id: 's1',
      scope: 'school',
      courseId: null,
      courseName: null,
      schoolName: 'Hill School',
      title: 'Sports day',
      body: 'Friday',
      createdAt: '2026-11-03T00:00:00.000Z',
      author: { firstName: 'H', lastName: 'Ead' },
    });
    const keys = keysDeep(res);
    for (const k of ['audience', 'readers', 'author_user_profile_id', 'avatar_url']) {
      expect(keys.has(k)).toBe(false);
    }
  });

  test('announcements hidden by the school: no school posts are read either', async () => {
    prisma.school.findUnique.mockResolvedValue({
      parent_settings: { showAnnouncements: false },
      disabled_features: [],
    });
    await expectRejection(service.announcementsFor(ctx));
    expect(announcements.findEveryoneForSchool).not.toHaveBeenCalled();
  });

  test('children: only linked children whose school has the portal on and allows them', async () => {
    const link = (id: string, schoolId: string, extra: Record<string, unknown> = {}) => ({
      relationship: 'mother',
      relationship_label: null,
      student: {
        id,
        first_name: id,
        last_name: 'X',
        is_active: true,
        date_of_birth: null,
        school_id: schoolId,
        school: { id: schoolId, name: schoolId, logo_path: null, is_active: true, parent_settings: {} },
        ...extra,
      },
    });
    const old = link('kid-old', 'school-1', { date_of_birth: new Date('1990-01-01') });
    old.student.school = { ...old.student.school, parent_settings: { maxStudentAge: 18 } };
    prisma.parent_student_link.findMany.mockResolvedValue([
      link('kid-on', 'school-1'),
      link('kid-off', 'school-off'),
      old,
    ]);
    prisma.school.findUnique.mockImplementation(async ({ where }: any) => ({
      disabled_features: where.id === 'school-off' ? ['parent_portal'] : [],
      parent_settings: {},
    }));
    const res = await service.children('parent-1');
    expect(res.map((c) => c.id)).toEqual(['kid-on']);
    expect(prisma.parent_student_link.findMany.mock.calls[0][0].where).toEqual({
      user_profile_id: 'parent-1',
    });
  });
});

describe('parent settings', () => {
  test('defaults, ignoring junk', () => {
    expect(parseParentSettings(null)).toEqual(DEFAULT_PARENT_SETTINGS);
    expect(parseParentSettings({ showGrades: 'no', maxStudentAge: 3, x: 1 })).toEqual(DEFAULT_PARENT_SETTINGS);
    expect(parseParentSettings({ showGrades: false, maxStudentAge: 18 })).toMatchObject({
      showGrades: false,
      maxStudentAge: 18,
    });
  });

  test('merge validates', () => {
    expect(mergeParentSettings(DEFAULT_PARENT_SETTINGS, { showGrades: false })).toEqual({
      settings: { ...DEFAULT_PARENT_SETTINGS, showGrades: false },
    });
    expect('error' in mergeParentSettings(DEFAULT_PARENT_SETTINGS, { showGrades: 1 })).toBe(true);
    expect('error' in mergeParentSettings(DEFAULT_PARENT_SETTINGS, { maxStudentAge: 5 })).toBe(true);
    expect('error' in mergeParentSettings(DEFAULT_PARENT_SETTINGS, { nope: true })).toBe(true);
    expect(mergeParentSettings({ ...DEFAULT_PARENT_SETTINGS, maxStudentAge: 18 }, { maxStudentAge: null })).toEqual({
      settings: DEFAULT_PARENT_SETTINGS,
    });
  });

  test('age limit', () => {
    const s = { ...DEFAULT_PARENT_SETTINGS, maxStudentAge: 18 };
    const now = new Date('2026-11-09T00:00:00Z');
    expect(excludedByAge(s, new Date('2008-11-09'), now)).toBe(true);
    expect(excludedByAge(s, new Date('2008-11-10'), now)).toBe(false);
    expect(excludedByAge(s, null, now)).toBe(false);
    expect(excludedByAge(DEFAULT_PARENT_SETTINGS, new Date('1950-01-01'), now)).toBe(false);
  });
});

describe('work states', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const item = (effectiveDueAt: string | null, submission: any = null) => ({
    id: 'a', courseId: 'c', courseName: 'C', kind: 'assignment', title: 'T', points: 1,
    effectiveDueAt, hasExtension: false, submission,
  });

  test('missing uses the effective due date (extensions included)', () => {
    expect(workState(item('2026-11-08T00:00:00Z'), now)).toBe('missing');
    // An extension pushed the child's date past now.
    expect(workState({ ...item('2026-11-10T00:00:00Z'), hasExtension: true }, now)).toBe('upcoming');
    expect(workState(item(null), now)).toBe('upcoming');
    expect(workState(item('2026-11-08T00:00:00Z', { status: 'submitted', excused: false }), now)).toBe('submitted');
    expect(workState(item('2026-11-08T00:00:00Z', { status: 'draft', excused: true }), now)).toBe('excused');
    expect(workState(item('2026-11-08T00:00:00Z', { status: 'draft', excused: false }), now)).toBe('missing');
  });

  test('splits into upcoming, missing and done', () => {
    const res = toParentWork(
      [item('2026-11-08T00:00:00Z'), item('2026-11-20T00:00:00Z'), item(null, { status: 'graded', score: 3, excused: false })],
      true,
      now,
    );
    expect(res.missing).toHaveLength(1);
    expect(res.upcoming).toHaveLength(1);
    expect(res.done[0].score).toBe(3);
  });
});
