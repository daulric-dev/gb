import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { FEATURE_KEY } from '@/features/require-feature.decorator';
import { AnalyticsService, courseTableCsv } from './analytics.service';
import { AnalyticsScheduler } from './analytics.scheduler';
import { AnalyticsController, CourseAnalyticsController } from './analytics.controller';

const NOW = new Date('2026-11-10T12:00:00Z');
const d = (iso: string) => new Date(iso);

const ACTIVITIES = [
  { id: 'a1', title: 'Essay', kind: 'assignment', points: 10, due_at: d('2026-11-05T12:00:00Z'), status: 'published', assignment_group_id: 'g1', omit_from_final_grade: false },
  { id: 'a2', title: 'Quiz', kind: 'quiz', points: 20, due_at: d('2026-11-20T12:00:00Z'), status: 'published', assignment_group_id: null, omit_from_final_grade: false },
  { id: 'a3', title: 'Lab', kind: 'offline', points: 5, due_at: null, status: 'closed', assignment_group_id: 'g1', omit_from_final_grade: false },
];

const c = (student: string, activity: string, over: Record<string, unknown> = {}) => ({
  student_id: student,
  activity_id: activity,
  status: null,
  score: null,
  excused: false,
  submitted_at: null,
  graded_at: null,
  late_seconds: 0,
  due_at: ACTIVITIES.find((a) => a.id === activity)!.due_at,
  ...over,
});

const CELLS = [
  c('s1', 'a1', { status: 'graded', score: 9, submitted_at: d('2026-11-04T10:00:00Z') }),
  c('s1', 'a2'),
  c('s1', 'a3', { status: 'graded', score: 5, graded_at: d('2026-11-06T10:00:00Z') }),
  c('s2', 'a1'),
  c('s2', 'a2'),
  c('s2', 'a3', { status: 'graded', score: 1, graded_at: d('2026-11-06T10:00:00Z') }),
  c('s3', 'a1', { status: 'graded', score: 5, submitted_at: d('2026-11-05T13:00:00Z'), late_seconds: 3600 }),
  c('s3', 'a2'),
  c('s3', 'a3'),
  // Someone no longer on the roster is ignored.
  c('gone', 'a1', { status: 'graded', score: 0 }),
];

const ATTENDANCE = [
  { student_id: 's1', attended: 9, counted: 10 },
  { student_id: 's3', attended: 5, counted: 10 },
];

type Perms = Record<string, { member: boolean; role: string; keys: string[] }>;

describe('AnalyticsService', () => {
  let prisma: MockPrisma;
  let perms: Perms;
  let features: Record<string, boolean>;
  let service: AnalyticsService;
  let rawCalls: string[];

  beforeEach(() => {
    prisma = createMockPrisma();
    rawCalls = [];
    perms = {
      'teacher:school-1': { member: true, role: 'teacher', keys: [] },
      'head:school-1': { member: true, role: 'member', keys: ['analytics:read'] },
      'plain:school-1': { member: true, role: 'teacher', keys: [] },
    };
    features = { analytics: true, attendance: true, mastery: false };
    prisma.user_profile.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'student' ? { school_id: null } : { school_id: 'school-1' },
    );
    prisma.school.findUnique.mockResolvedValue({ time_zone: 'UTC' });
    prisma.assignment_group.findMany.mockResolvedValue([
      { id: 'g1', name: 'Homework', weight: null, position: 0, drop_lowest: 0, drop_highest: 0 },
    ]);
    prisma.activity.findMany.mockResolvedValue(ACTIVITIES);
    prisma.course_student.findMany.mockResolvedValue([
      { student: { id: 's1', first_name: 'Ann', last_name: 'Lee' } },
      { student: { id: 's2', first_name: '=Evil()', last_name: 'Abe' } },
      { student: { id: 's3', first_name: 'Cy', last_name: 'Cho' } },
    ]);
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      rawCalls.push(sql);
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
      if (sql.includes('attendance_record')) return ATTENDANCE;
      return CELLS;
    });
    prisma.course.findUnique.mockImplementation(async ({ where }: any) =>
      ({
        c9: { id: 'c9', school_id: 'school-1', name: 'History', code: 'HI', is_template: false },
        tpl: { id: 'tpl', school_id: 'school-1', name: 'Template', code: null, is_template: true },
        far: { id: 'far', school_id: 'school-2', name: 'Elsewhere', code: null, is_template: false },
      })[where.id as string] ?? null,
    );
    const cache = {
      get: async (key: string) => {
        const [, , user, school] = key.split(':');
        return perms[`${user}:${school}`] ?? { member: false, role: null, keys: [] };
      },
      set: async () => undefined,
    };
    const access = {
      require: async (userId: string, courseId: string) => {
        if (userId === 'teacher' && courseId === 'c1') {
          return { course: { id: 'c1', school_id: 'school-1', name: 'Maths', code: 'MA' }, role: 'teacher' };
        }
        throw new NotFoundException('Course not found');
      },
    };
    const featureService = {
      effective: async () => features,
      isEnabled: async (_s: string, k: string) => !!features[k],
    };
    service = new AnalyticsService(prisma as any, cache as any, access as any, featureService as any);
  });

  // ── course maths ─────────────────────────────────────────────────────────

  test('course analytics: rates per activity, distributions, groups, trend', async () => {
    const v = await service.course('teacher', 'c1', NOW);
    expect(v.students).toBe(3);
    const [a1, a2, a3] = v.activities;
    expect(a1).toMatchObject({ onTime: 1, late: 1, missing: 1, pending: 0, rate: 66.7, onTimeRate: 33.3, group: 'Homework' });
    expect(a1.distribution).toMatchObject({ count: 2, median: 70, q1: 60, q3: 80, min: 50, max: 90 });
    // Not due yet: nothing missing, no rate.
    expect(a2).toMatchObject({ onTime: 0, missing: 0, pending: 3, rate: null });
    // Offline: never missing.
    expect(a3).toMatchObject({ onTime: 2, missing: 0, pending: 1, rate: 100 });
    expect(v.overview.submission).toMatchObject({ onTime: 3, late: 1, missing: 1, rate: 80 });

    // Course grades by the gradebook's rules: s1 14/15, s2 1/5, s3 5/10.
    expect(v.gradeDistribution).toMatchObject({ count: 3, median: 50, min: 20, max: 93.3 });
    expect(v.overview.averageGrade).toBe(54.4);
    expect(v.groups).toEqual([
      { groupId: 'g1', name: 'Homework', weight: null, average: 54.4, students: 3 },
      // The quiz is ungrouped and nothing in it is marked yet.
      { groupId: null, name: 'Ungrouped', weight: null, average: null, students: 0 },
    ]);
    expect(v.trend).toEqual([{ week: '2026-11-02', average: 65, count: 4 }]);
    expect(v.overview.attendanceRate).toBe(70);
  });

  test('at risk: reasons per student, most reasons first; dropped students never listed', async () => {
    const v = await service.course('teacher', 'c1', NOW);
    expect(v.atRisk.map((s) => [s.lastName, s.reasons.map((r) => r.rule)])).toEqual([
      ['Cho', ['grade', 'attendance']],
      ['Abe', ['grade']],
    ]);
    expect(v.atRisk[0].reasons[1].text).toBe('Attendance 50% over the last 4 weeks is below 90%');
    expect(v.overview.atRisk).toBe(2);
  });

  test('configured rules apply; missing counts only work due in the window', async () => {
    prisma.analytics_setting.findUnique.mockResolvedValue({
      min_grade: null,
      missing_count: 1,
      window_weeks: 1,
      min_attendance: null,
      mastery_below_level: null,
    });
    let v = await service.course('teacher', 'c1', NOW);
    expect(v.atRisk.map((s) => [s.lastName, s.reasons.map((r) => r.text)])).toEqual([
      ['Abe', ['1 piece of work missing in the last 1 week']],
    ]);
    // Three weeks later the missing essay is outside a one-week window.
    v = await service.course('teacher', 'c1', new Date('2026-12-01T12:00:00Z'));
    expect(v.atRisk.filter((s) => s.reasons.some((r) => r.rule === 'missing')).map((s) => s.lastName)).toEqual([]);
  });

  test('attendance off: no attendance query, rate or reason', async () => {
    features = { analytics: true, attendance: false, mastery: false };
    const v = await service.course('teacher', 'c1', NOW);
    expect(rawCalls.some((s) => s.includes('attendance_record'))).toBe(false);
    expect(v.overview.attendanceRate).toBeNull();
    expect(v.features).toEqual({ attendance: false, mastery: false });
    expect(v.atRisk.flatMap((s) => s.reasons.map((r) => r.rule))).not.toContain('attendance');
  });

  test('mastery on: average mastery below the level is a reason; off: evidence is not read', async () => {
    prisma.outcome_evidence.findMany.mockResolvedValue([
      { id: 'e1', outcome_id: 'o1', student_id: 's1', course_id: 'c1', activity_id: 'a1', source: 'activity', ratio: 0.2, rating_rank: null, rating_count: null, assessed_at: d('2026-11-01T00:00:00Z') },
      { id: 'e2', outcome_id: 'o2', student_id: 's1', course_id: 'c1', activity_id: 'a1', source: 'activity', ratio: 0.95, rating_rank: null, rating_count: null, assessed_at: d('2026-11-01T00:00:00Z') },
    ]);
    let v = await service.course('teacher', 'c1', NOW);
    expect(prisma.outcome_evidence.findMany).not.toHaveBeenCalled();
    expect(v.atRisk.some((s) => s.lastName === 'Lee')).toBe(false);

    features = { analytics: true, attendance: true, mastery: true };
    v = await service.course('teacher', 'c1', NOW);
    // Levels 1 and 4 average 2.5: not below 2.
    expect(v.atRisk.some((s) => s.lastName === 'Lee')).toBe(false);
    prisma.outcome_evidence.findMany.mockResolvedValue([
      { id: 'e1', outcome_id: 'o1', student_id: 's1', course_id: 'c1', activity_id: 'a1', source: 'activity', ratio: 0.2, rating_rank: null, rating_count: null, assessed_at: d('2026-11-01T00:00:00Z') },
    ]);
    v = await service.course('teacher', 'c1', NOW);
    const lee = v.atRisk.find((s) => s.lastName === 'Lee')!;
    expect(lee.masteryScore).toBe(1);
    expect(lee.reasons.map((r) => r.text)).toEqual(['Average mastery 1 is below level 2 (Developing)']);
  });

  test('the course view is a fixed number of queries (no per-student or per-activity queries)', async () => {
    await service.course('teacher', 'c1', NOW);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.activity.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.course_student.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
    expect(prisma.course_student.findMany.mock.calls[0][0].where).toEqual({
      course_id: 'c1',
      status: { in: ['active', 'completed'] },
    });
  });

  // ── access ───────────────────────────────────────────────────────────────

  test('course staff see their course; analytics:read sees any course in the school', async () => {
    expect((await service.course('teacher', 'c1', NOW)).course.id).toBe('c1');
    expect((await service.course('head', 'c9', NOW)).course.name).toBe('History');
  });

  test('no role and no analytics:read is a 404; another school, a template or a student too', async () => {
    expect(await expectRejection(service.course('plain', 'c9', NOW))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(service.course('head', 'far', NOW))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(service.course('head', 'tpl', NOW))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(service.course('head', 'missing', NOW))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(service.course('student', 'c1', NOW))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(service.courseCsv('plain', 'c9', 'activities', NOW))).toBeInstanceOf(NotFoundException);
  });

  test('school reads need a school and a membership', async () => {
    expect(await expectRejection(service.school('student'))).toBeInstanceOf(BadRequestException);
    perms['head:school-1'] = { member: false, role: 'member', keys: [] };
    expect(await expectRejection(service.school('head'))).toBeInstanceOf(ForbiddenException);
    expect(await expectRejection(service.schoolAtRisk('head'))).toBeInstanceOf(ForbiddenException);
  });

  test('routes: school reads need analytics:read, settings school:update, everything the analytics flag', () => {
    const meta = (target: object, key: string) => Reflect.getMetadata(PERMISSION_KEY, (target as any)[key]);
    const proto = AnalyticsController.prototype;
    for (const m of ['school', 'atRisk', 'export', 'refresh']) expect(meta(proto, m)).toBe('analytics:read');
    expect(meta(proto, 'updateSettings')).toBe('school:update');
    expect(meta(proto, 'settings')).toBeUndefined();
    expect(Reflect.getMetadata(FEATURE_KEY, AnalyticsController)).toEqual(['analytics']);
    expect(Reflect.getMetadata(FEATURE_KEY, CourseAnalyticsController)).toEqual(['analytics']);
    // The course routes have no catalog key: the service checks course role or analytics:read.
    expect(meta(CourseAnalyticsController.prototype, 'get')).toBeUndefined();
  });

  // ── school (cached rows) ─────────────────────────────────────────────────

  const summary = (course: string, name: string, teachers: [string, string][], over: Record<string, number> = {}) => ({
    course_id: course,
    school_id: 'school-1',
    students: 10,
    graded_students: 10,
    grade_sum: 700,
    on_time: 8,
    late: 1,
    missing: 1,
    excused: 0,
    attendance_counted: 100,
    attendance_attended: 95,
    at_risk: 2,
    computed_at: NOW,
    ...over,
    course: {
      id: course,
      name,
      code: null,
      status: 'published',
      term_id: 't1',
      academic_year_id: 'y1',
      course_staff: teachers.map(([id, first]) => ({ user_profile: { id, first_name: first, last_name: 'T' } })),
    },
  });

  test('school roll-ups per course and teacher come from summary rows of the caller’s school only', async () => {
    prisma.analytics_course_summary.findMany.mockResolvedValue([
      summary('c1', 'Maths', [['u1', 'Ada']]),
      summary('c2', 'Art', [['u1', 'Ada'], ['u2', 'Bo']], { students: 5, graded_students: 5, grade_sum: 450, on_time: 3, late: 0, missing: 3, attendance_counted: 0, attendance_attended: 0, at_risk: 1 }),
    ]);
    prisma.analytics_refresh.findUnique.mockResolvedValue({ refreshed_at: NOW });
    prisma.analytics_at_risk.findMany.mockResolvedValue([{ student_id: 's1' }, { student_id: 's1' }, { student_id: 's2' }]);

    const r = await service.school('head', { termId: 't1' });
    const where = prisma.analytics_course_summary.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ school_id: 'school-1', course: { school_id: 'school-1', is_template: false, term_id: 't1' } });
    expect(prisma.analytics_at_risk.findMany.mock.calls[0][0].where.school_id).toBe('school-1');
    expect(prisma.term.findMany.mock.calls[0][0].where).toEqual({ academic_year: { school_id: 'school-1' } });
    expect(r.lastUpdated).toBe(NOW.toISOString());
    expect(r.courses.map((x) => [x.name, x.averageGrade, x.submissionRate, x.attendanceRate, x.teachers])).toEqual([
      ['Art', 90, 50, null, ['Ada T', 'Bo T']],
      ['Maths', 70, 90, 95, ['Ada T']],
    ]);
    expect(r.teachers.map((t) => [t.name, t.courses, t.enrolments, t.averageGrade, t.submissionRate, t.atRisk])).toEqual([
      ['Ada T', 2, 15, 76.7, 75, 3],
      ['Bo T', 1, 5, 90, 50, 1],
    ]);
    expect(r.totals).toMatchObject({ courses: 2, enrolments: 15, averageGrade: 76.7, submissionRate: 75, attendanceRate: 95, atRisk: 3, atRiskStudents: 2 });
  });

  test('school at-risk list is scoped to the school and filtered by year', async () => {
    prisma.analytics_at_risk.findMany.mockResolvedValue([
      { course_id: 'c1', student_id: 's1', grade: 40, missing: 0, attendance_rate: null, mastery_score: null, reasons: [{ rule: 'grade', text: 'g' }], computed_at: NOW, course: { name: 'Maths', code: null }, student: { first_name: 'A', last_name: 'Z' } },
      { course_id: 'c2', student_id: 's2', grade: 40, missing: 4, attendance_rate: null, mastery_score: null, reasons: [{ rule: 'grade', text: 'g' }, { rule: 'missing', text: 'm' }], computed_at: NOW, course: { name: 'Art', code: null }, student: { first_name: 'B', last_name: 'Y' } },
    ]);
    const r = await service.schoolAtRisk('head', { academicYearId: 'y1' });
    expect(prisma.analytics_at_risk.findMany.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      course: { school_id: 'school-1', is_template: false, academic_year_id: 'y1' },
    });
    expect(r.students.map((s) => s.studentId)).toEqual(['s2', 's1']);
  });

  // ── refresh / sweep ──────────────────────────────────────────────────────

  test('refresh writes summary and at-risk rows per course; running it twice writes the same rows', async () => {
    prisma.course.findMany.mockResolvedValue([{ id: 'c1', school_id: 'school-1', name: 'Maths', code: 'MA' }]);
    expect(await service.refreshSchool('school-1', NOW)).toBe(1);
    expect(await service.refreshSchool('school-1', NOW)).toBe(1);

    const upserts = prisma.analytics_course_summary.upsert.mock.calls.map((x: any[]) => x[0]);
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toEqual(upserts[1]);
    expect(upserts[0].create).toMatchObject({
      course_id: 'c1',
      school_id: 'school-1',
      students: 3,
      graded_students: 3,
      on_time: 3,
      late: 1,
      missing: 1,
      attendance_counted: 20,
      attendance_attended: 14,
      at_risk: 2,
    });
    const creates = prisma.analytics_at_risk.createMany.mock.calls.map((x: any[]) => x[0]);
    expect(creates[0]).toEqual(creates[1]);
    expect(creates[0].data.map((r: any) => r.student_id)).toEqual(['s3', 's2']);
    // Each course's rows are replaced, never appended.
    const deletes = prisma.analytics_at_risk.deleteMany.mock.calls.map((x: any[]) => x[0].where);
    expect(deletes).toContainEqual({ course_id: 'c1' });
    // Rows of courses no longer summarised are removed, and the refresh stamped.
    expect(prisma.analytics_course_summary.deleteMany.mock.calls[0][0].where).toEqual({ school_id: 'school-1', course_id: { notIn: ['c1'] } });
    expect(prisma.analytics_refresh.upsert.mock.calls[0][0].create).toMatchObject({ school_id: 'school-1', refreshed_at: NOW, courses: 1 });
    expect(prisma.course.findMany.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      is_template: false,
      status: { in: ['published', 'archived'] },
    });
  });

  test('refresh does nothing while the feature is off', async () => {
    features = { analytics: false, attendance: true, mastery: false };
    prisma.course.findMany.mockResolvedValue([{ id: 'c1', school_id: 'school-1', name: 'Maths', code: 'MA' }]);
    expect(await service.refreshSchool('school-1', NOW)).toBe(0);
    expect(prisma.analytics_course_summary.upsert).not.toHaveBeenCalled();
    expect(prisma.analytics_refresh.upsert).not.toHaveBeenCalled();
  });

  test('the sweep runs under the advisory lock and skips when another instance holds it', async () => {
    const scheduler = new AnalyticsScheduler(prisma as any, service);
    prisma.school.findMany.mockResolvedValue([{ id: 'school-1' }]);
    await scheduler.tick(NOW);
    expect(rawCalls.some((s) => s.includes('pg_try_advisory_xact_lock'))).toBe(true);
    expect(prisma.analytics_refresh.upsert).toHaveBeenCalledTimes(1);

    prisma.$queryRaw.mockImplementation(async () => [{ locked: false }]);
    await scheduler.tick(NOW);
    expect(prisma.analytics_refresh.upsert).toHaveBeenCalledTimes(1);
  });

  test('"refresh now" is ignored shortly after the last refresh', async () => {
    const scheduler = new AnalyticsScheduler(prisma as any, service);
    prisma.analytics_refresh.findUnique.mockResolvedValue({ refreshed_at: new Date(NOW.getTime() - 30_000) });
    expect(await scheduler.refreshNow('school-1', NOW)).toEqual({ started: false, lastUpdated: new Date(NOW.getTime() - 30_000).toISOString() });
    prisma.analytics_refresh.findUnique.mockResolvedValue({ refreshed_at: new Date(NOW.getTime() - 10 * 60_000) });
    expect((await scheduler.refreshNow('school-1', NOW)).started).toBe(true);
  });

  // ── CSV and settings ─────────────────────────────────────────────────────

  test('CSV exports defuse formulas in names and titles', async () => {
    const out = await service.courseCsv('teacher', 'c1', 'at-risk', NOW);
    expect(out.filename).toBe('MA-analytics-at-risk.csv');
    expect(out.csv).toContain(`Abe,'=Evil(),20,`);
    const v = await service.course('teacher', 'c1', NOW);
    v.activities[0].title = '@SUM(1)';
    expect(courseTableCsv(v, 'activities')).toContain("'@SUM(1),assignment,Homework,10,");
    expect(courseTableCsv(v, 'distribution')).toContain('Median %,50');
    expect(courseTableCsv(v, 'trend')).toBe('Week of,Average %,Marks\r\n2026-11-02,65,4\r\n');
  });

  test('settings: defaults without a row; an update keeps unspecified rules', async () => {
    expect((await service.settings('teacher')).rules).toEqual({ minGrade: 60, missingCount: 3, windowWeeks: 4, minAttendance: 90, masteryBelowLevel: 2 });
    await service.updateSettings('head', { minGrade: null, windowWeeks: 6 });
    const args = prisma.analytics_setting.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ school_id: 'school-1' });
    expect(args.create).toMatchObject({ min_grade: null, missing_count: 3, window_weeks: 6, min_attendance: 90, mastery_below_level: 2 });
  });

  test('the migration creates the tables and the analytics:read key, granting it to no role', () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261129100000_analytics/migration.sql'), 'utf8');
    for (const t of ['analytics_setting', 'analytics_course_summary', 'analytics_at_risk', 'analytics_refresh']) {
      expect(sql).toContain(`CREATE TABLE public.${t}`);
    }
    expect(sql).toContain("'analytics:read'");
    expect(sql).not.toContain('school_role_permission');
    expect(sql).not.toContain('report-card:read');
  });
});
