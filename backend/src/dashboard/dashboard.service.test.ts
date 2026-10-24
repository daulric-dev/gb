import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const d = (iso: string) => new Date(iso);

function course(
  id: string,
  name: string,
  status: 'draft' | 'published' | 'archived' = 'published',
  created = '2026-01-01T00:00:00.000Z',
) {
  return { id, name, code: id.toUpperCase(), status, created_at: d(created) };
}

describe('DashboardService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let service: DashboardService;

  /** A staff user in school-1 with the given school role. */
  const staffUser = (role: 'admin' | 'teacher' | 'member' = 'teacher') => {
    prisma.user_profile.findUnique.mockImplementation(async ({ select }) =>
      select.account_type
        ? { account_type: 'staff' }
        : { school_id: 'school-1' },
    );
    prisma.school_management.findFirst.mockResolvedValue({
      role,
      school_management_role: [],
    });
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    service = new DashboardService(cache as any, prisma as any);
    setSystemTime(d('2026-10-15T12:00:00.000Z'));
  });

  afterEach(() => {
    setSystemTime();
  });

  describe('preconditions', () => {
    test('403 Staff only for a student account', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({
        account_type: 'student',
        school_id: 'school-1',
      });
      const err = await expectRejection(service.summary('u1'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe('Staff only');
    });

    test('400 when the user has no school', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({
        account_type: 'staff',
        school_id: null,
      });
      const err = await expectRejection(service.summary('u1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('You are not assigned to a school');
    });

    test('400 when the user has no profile at all', async () => {
      const err = await expectRejection(service.summary('ghost'));
      expect(err).toBeInstanceOf(BadRequestException);
    });
  });

  describe('teacher view', () => {
    beforeEach(() => staffUser('teacher'));

    test('isAdmin false, school null, no school-wide queries', async () => {
      const res = await service.summary('u1');
      expect(res.schoolId).toBe('school-1');
      expect(res.isAdmin).toBe(false);
      expect(res.school).toBeNull();
      expect(res.myCourses).toEqual([]);
      expect(res.awaitingMarking).toBe(0);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
      expect(prisma.announcement.findMany).not.toHaveBeenCalled();
    });

    test('no staff rows: course table is never read', async () => {
      await service.summary('u1');
      expect(prisma.course.findMany).not.toHaveBeenCalled();
      expect(prisma.course_student.groupBy).not.toHaveBeenCalled();
      expect(prisma.submission.findMany).not.toHaveBeenCalled();
    });

    test('my courses carry role, student counts and awaiting marking', async () => {
      prisma.course_staff.findMany.mockResolvedValue([
        { course_id: 'c1', role: 'teacher' },
        { course_id: 'c2', role: 'ta' },
      ]);
      prisma.course.findMany.mockResolvedValue([
        course('c1', 'Algebra'),
        course('c2', 'Biology', 'draft'),
      ]);
      prisma.course_student.groupBy.mockResolvedValue([
        { course_id: 'c1', _count: { _all: 12 } },
      ]);
      prisma.submission.findMany.mockResolvedValue([
        { activity: { course_id: 'c1' } },
        { activity: { course_id: 'c2' } },
        { activity: { course_id: 'c1' } },
        { activity: { course_id: null } },
      ]);

      const res = await service.summary('u1');
      expect(res.myCourses).toEqual([
        {
          id: 'c1',
          name: 'Algebra',
          code: 'C1',
          status: 'published',
          role: 'teacher',
          studentCount: 12,
          awaitingMarking: 2,
        },
        {
          id: 'c2',
          name: 'Biology',
          code: 'C2',
          status: 'draft',
          role: 'ta',
          studentCount: 0,
          awaitingMarking: 1,
        },
      ]);
      expect(res.awaitingMarking).toBe(3);
    });

    test('scopes the course query to the school, staff ids and non-archived', async () => {
      prisma.course_staff.findMany.mockResolvedValue([
        { course_id: 'c1', role: 'teacher' },
      ]);
      await service.summary('u1');
      expect(prisma.course_staff.findMany.mock.calls[0][0].where).toEqual({
        user_profile_id: 'u1',
      });
      const arg = prisma.course.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        school_id: 'school-1',
        id: { in: ['c1'] },
        status: { not: 'archived' },
      });
      expect(arg.orderBy).toEqual({ name: 'asc' });
    });

    test('counts only active enrolments and submitted submissions', async () => {
      prisma.course_staff.findMany.mockResolvedValue([
        { course_id: 'c1', role: 'teacher' },
      ]);
      prisma.course.findMany.mockResolvedValue([course('c1', 'Algebra')]);
      await service.summary('u1');
      expect(prisma.course_student.groupBy.mock.calls[0][0].where).toEqual({
        course_id: { in: ['c1'] },
        status: 'active',
      });
      expect(prisma.submission.findMany.mock.calls[0][0].where).toEqual({
        status: 'submitted',
        activity: { course_id: { in: ['c1'] } },
      });
    });

    test('staff rows whose courses are all archived/elsewhere: no count queries', async () => {
      prisma.course_staff.findMany.mockResolvedValue([
        { course_id: 'c1', role: 'teacher' },
      ]);
      prisma.course.findMany.mockResolvedValue([]);
      const res = await service.summary('u1');
      expect(res.myCourses).toEqual([]);
      expect(prisma.course_student.groupBy).not.toHaveBeenCalled();
      expect(prisma.submission.findMany).not.toHaveBeenCalled();
    });

    test('a course query failure becomes a 400', async () => {
      prisma.course_staff.findMany.mockResolvedValue([
        { course_id: 'c1', role: 'teacher' },
      ]);
      prisma.course.findMany.mockRejectedValue(new Error('db down'));
      const err = await expectRejection(service.summary('u1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('Failed to load dashboard summary');
    });
  });

  describe('active year', () => {
    beforeEach(() => staffUser('teacher'));

    const year = (id: string, start: string, end: string) => ({
      id,
      name: `Year ${id}`,
      start_date: d(`${start}T00:00:00.000Z`),
      end_date: d(`${end}T00:00:00.000Z`),
    });

    test('null when the school has no years', async () => {
      expect((await service.summary('u1')).activeYear).toBeNull();
    });

    test('the year covering today', async () => {
      prisma.academic_year.findMany.mockResolvedValue([
        year('next', '2027-09-01', '2028-07-01'),
        year('now', '2026-09-01', '2027-07-01'),
        year('past', '2025-09-01', '2026-07-01'),
      ]);
      expect((await service.summary('u1')).activeYear).toEqual({
        id: 'now',
        name: 'Year now',
        startDate: '2026-09-01',
        endDate: '2027-07-01',
      });
    });

    test('inclusive at both ends', async () => {
      prisma.academic_year.findMany.mockResolvedValue([
        year('ends-today', '2026-01-01', '2026-10-15'),
      ]);
      expect((await service.summary('u1')).activeYear?.id).toBe('ends-today');
      prisma.academic_year.findMany.mockResolvedValue([
        year('starts-today', '2026-10-15', '2027-06-01'),
      ]);
      expect((await service.summary('u1')).activeYear?.id).toBe('starts-today');
    });

    test('falls back to the first (most recent by start) when none covers today', async () => {
      prisma.academic_year.findMany.mockResolvedValue([
        year('newest', '2025-09-01', '2026-07-01'),
        year('older', '2024-09-01', '2025-07-01'),
      ]);
      expect((await service.summary('u1')).activeYear?.id).toBe('newest');
      const arg = prisma.academic_year.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ school_id: 'school-1' });
      expect(arg.orderBy).toEqual({ start_date: 'desc' });
    });
  });

  describe('admin view', () => {
    beforeEach(() => staffUser('admin'));

    test('isAdmin true and the school overview is computed', async () => {
      prisma.course.findMany.mockResolvedValue([
        course('c1', 'Algebra', 'draft'),
        course('c2', 'Biology', 'published'),
        course('c3', 'Chem', 'published'),
        course('c4', 'Drama', 'archived'),
      ]);
      prisma.student.findMany.mockResolvedValue([
        { id: 's1', is_active: true },
        { id: 's2', is_active: false },
        { id: 's3', is_active: null },
      ]);
      prisma.school_management.findMany.mockResolvedValue([
        { id: 'm1', role: 'admin' },
        { id: 'm2', role: 'teacher' },
        { id: 'm3', role: 'teacher' },
        { id: 'm4', role: 'member' },
      ]);

      const res = await service.summary('u1');
      expect(res.isAdmin).toBe(true);
      expect(res.school?.courses).toEqual({
        total: 4,
        draft: 1,
        published: 2,
        archived: 1,
      });
      // null is_active counts as active (only an explicit false does not).
      expect(res.school?.students).toEqual({ total: 3, active: 2 });
      expect(res.school?.staff).toEqual({
        total: 4,
        admins: 1,
        teachers: 2,
        members: 1,
      });
    });

    test('admin myCourses still come only from course_staff rows', async () => {
      const res = await service.summary('u1');
      expect(res.myCourses).toEqual([]);
      expect(prisma.course_staff.findMany).toHaveBeenCalled();
    });

    test('school queries are scoped to the school', async () => {
      await service.summary('u1');
      expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
      });
      expect(prisma.school_management.findMany.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
      });
      expect(prisma.announcement.findMany.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
        course_id: { not: null },
      });
    });

    test('no courses: activity is not queried, announcements still are', async () => {
      prisma.announcement.findMany.mockResolvedValue([
        {
          id: 'n1',
          title: 'Hello',
          course_id: 'gone',
          created_at: d('2026-10-01T00:00:00.000Z'),
        },
      ]);
      const res = await service.summary('u1');
      expect(prisma.activity.findMany).not.toHaveBeenCalled();
      expect(res.school?.recentActivity).toEqual([
        {
          type: 'announcement',
          id: 'n1',
          title: 'Hello',
          courseId: 'gone',
          courseName: null,
          at: '2026-10-01T00:00:00.000Z',
        },
      ]);
    });

    test('recent activity merges all three kinds, newest first', async () => {
      prisma.course.findMany.mockResolvedValue([
        course('c1', 'Algebra', 'published', '2026-09-01T00:00:00.000Z'),
        course('c2', 'Biology', 'draft', '2026-09-03T00:00:00.000Z'),
      ]);
      prisma.activity.findMany.mockResolvedValue([
        {
          id: 'a1',
          title: 'Quiz 1',
          course_id: 'c1',
          published_at: d('2026-09-04T00:00:00.000Z'),
        },
      ]);
      prisma.announcement.findMany.mockResolvedValue([
        {
          id: 'n1',
          title: 'Welcome',
          course_id: 'c2',
          created_at: d('2026-09-02T00:00:00.000Z'),
        },
        { id: 'n2', title: 'Undated', course_id: 'c2', created_at: null },
      ]);

      const res = await service.summary('u1');
      expect(res.school?.recentActivity).toEqual([
        {
          type: 'activity_published',
          id: 'a1',
          title: 'Quiz 1',
          courseId: 'c1',
          courseName: 'Algebra',
          at: '2026-09-04T00:00:00.000Z',
        },
        {
          type: 'course_created',
          id: 'c2',
          title: 'Biology',
          courseId: 'c2',
          courseName: 'Biology',
          at: '2026-09-03T00:00:00.000Z',
        },
        {
          type: 'announcement',
          id: 'n1',
          title: 'Welcome',
          courseId: 'c2',
          courseName: 'Biology',
          at: '2026-09-02T00:00:00.000Z',
        },
        {
          type: 'course_created',
          id: 'c1',
          title: 'Algebra',
          courseId: 'c1',
          courseName: 'Algebra',
          at: '2026-09-01T00:00:00.000Z',
        },
      ]);
    });

    test('recent activity is capped at 10, keeping the newest', async () => {
      const courses = Array.from({ length: 15 }, (_, i) =>
        course(
          `c${i}`,
          `Course ${i}`,
          'published',
          `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        ),
      );
      prisma.course.findMany.mockResolvedValue(courses);
      const res = await service.summary('u1');
      const ids = res.school!.recentActivity.map((e) => e.id);
      expect(ids).toHaveLength(10);
      expect(ids[0]).toBe('c14');
      expect(ids[9]).toBe('c5');
    });

    test('activity and announcement queries take 10, newest first', async () => {
      prisma.course.findMany.mockResolvedValue([course('c1', 'Algebra')]);
      await service.summary('u1');
      const act = prisma.activity.findMany.mock.calls[0][0];
      expect(act.where).toEqual({
        course_id: { in: ['c1'] },
        published_at: { not: null },
      });
      expect(act.orderBy).toEqual({ published_at: 'desc' });
      expect(act.take).toBe(10);
      const ann = prisma.announcement.findMany.mock.calls[0][0];
      expect(ann.orderBy).toEqual({ created_at: { sort: 'desc', nulls: 'first' } });
      expect(ann.take).toBe(10);
    });

    test('an archived course is counted in the school but not in myCourses', async () => {
      prisma.course_staff.findMany.mockResolvedValue([
        { course_id: 'c4', role: 'teacher' },
      ]);
      prisma.course.findMany.mockImplementation(async ({ where }) =>
        where.status ? [] : [course('c4', 'Drama', 'archived')],
      );
      const res = await service.summary('u1');
      expect(res.myCourses).toEqual([]);
      expect(res.school?.courses.archived).toBe(1);
    });
  });

  test('a custom role with course:update gets the admin view', async () => {
    staffUser('member');
    prisma.school_management.findFirst.mockResolvedValue({
      role: 'member',
      school_management_role: [
        {
          school_role: {
            school_role_permission: [
              { permission_catalog: { key: 'course:update' } },
            ],
          },
        },
      ],
    });
    const res = await service.summary('u1');
    expect(res.isAdmin).toBe(true);
    expect(res.school).not.toBeNull();
  });
});
