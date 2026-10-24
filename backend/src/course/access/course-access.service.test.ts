import { beforeEach, describe, expect, test } from 'bun:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
  toCourseRow,
  type CourseRow,
} from './course-access.service';
import { permCacheKey } from '@/permission/permission.effective';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const CREATED = new Date('2026-01-02T03:04:05.000Z');
const UPDATED = new Date('2026-02-03T04:05:06.000Z');

function dbCourse(over: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    school_id: 'school-1',
    academic_year_id: null,
    term_id: null,
    name: 'Biology',
    code: 'BIO',
    description: null,
    status: 'published',
    join_code: null,
    grade_scale_id: null,
    is_template: false,
    created_by: 'creator',
    created_at: CREATED,
    updated_at: UPDATED,
    ...over,
  };
}

describe('CourseAccessService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let service: CourseAccessService;

  /** School membership as `loadEffectivePermissions` sees it. */
  const membership = (role: 'admin' | 'teacher' | 'member' | null) =>
    prisma.school_management.findFirst.mockResolvedValue(
      role ? { role, school_management_role: [] } : null,
    );

  const staffRow = (role: 'teacher' | 'ta' | null) =>
    prisma.course_staff.findUnique.mockResolvedValue(role ? { role } : null);

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    prisma.course.findUnique.mockResolvedValue(dbCourse());
    service = new CourseAccessService(cache as any, prisma as any);
  });

  describe('constants and toCourseRow', () => {
    test('MANAGE_ROLES excludes ta; STAFF_ROLES includes it', () => {
      expect([...MANAGE_ROLES]).toEqual(['admin', 'teacher']);
      expect([...STAFF_ROLES]).toEqual(['admin', 'teacher', 'ta']);
    });

    test('toCourseRow turns timestamps into ISO strings', () => {
      const row = toCourseRow(dbCourse() as any);
      expect(row.created_at).toBe('2026-01-02T03:04:05.000Z');
      expect(row.updated_at).toBe('2026-02-03T04:05:06.000Z');
    });

    test('toCourseRow defaults a missing is_template to false', () => {
      const { is_template: _omit, ...rest } = dbCourse();
      expect(toCourseRow(rest as any).is_template).toBe(false);
      expect(toCourseRow(dbCourse({ is_template: true }) as any).is_template).toBe(
        true,
      );
    });
  });

  describe('roleIn', () => {
    const course = () => toCourseRow(dbCourse() as any) as CourseRow;

    test('admin when effective permissions include course:update', async () => {
      membership('admin');
      staffRow(null);
      expect(await service.roleIn('u1', course())).toBe('admin');
    });

    test('admin wins over a course_staff teacher/ta row', async () => {
      membership('admin');
      staffRow('ta');
      expect(await service.roleIn('u1', course())).toBe('admin');
    });

    test('a custom role granting course:update makes a member an admin', async () => {
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
      expect(await service.roleIn('u1', course())).toBe('admin');
    });

    test('teacher from a course_staff row', async () => {
      membership('teacher');
      staffRow('teacher');
      expect(await service.roleIn('u1', course())).toBe('teacher');
    });

    test('ta from a course_staff row', async () => {
      membership('member');
      staffRow('ta');
      expect(await service.roleIn('u1', course())).toBe('ta');
    });

    test('null for a school member with no staff row', async () => {
      membership('teacher');
      staffRow(null);
      expect(await service.roleIn('u1', course())).toBeNull();
    });

    test('null for an unknown staff role value', async () => {
      membership('teacher');
      prisma.course_staff.findUnique.mockResolvedValue({ role: 'observer' });
      expect(await service.roleIn('u1', course())).toBeNull();
    });

    test('null for someone removed from the school even with a staff row', async () => {
      membership(null);
      staffRow('teacher');
      expect(await service.roleIn('u1', course())).toBeNull();
    });

    test('a cached non-member result also yields null', async () => {
      cache._store.set(permCacheKey('u1', 'school-1'), {
        value: { member: false, role: null, keys: ['course:update'] },
        ttl: 45,
      });
      staffRow('teacher');
      expect(await service.roleIn('u1', course())).toBeNull();
    });

    test('looks up course_staff by the compound key and permissions by the course school', async () => {
      membership('teacher');
      staffRow('teacher');
      await service.roleIn('u1', course());
      expect(prisma.course_staff.findUnique.mock.calls[0][0].where).toEqual({
        course_id_user_profile_id: {
          course_id: 'course-1',
          user_profile_id: 'u1',
        },
      });
      expect(prisma.school_management.findFirst.mock.calls[0][0].where).toEqual({
        user_id: 'u1',
        school_id: 'school-1',
      });
      expect(cache._store.has(permCacheKey('u1', 'school-1'))).toBe(true);
    });
  });

  describe('require', () => {
    test('404 when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      const err = await expectRejection(service.require('u1', 'missing'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Course not found');
    });

    test('404 (not 403) when the caller has no role in the course', async () => {
      membership('teacher');
      staffRow(null);
      const err = await expectRejection(service.require('u1', 'course-1'));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('404 for a course in another school', async () => {
      prisma.course.findUnique.mockResolvedValue(
        dbCourse({ school_id: 'school-2' }),
      );
      // Member only of school-1.
      prisma.school_management.findFirst.mockImplementation(async ({ where }) =>
        where.school_id === 'school-1'
          ? { role: 'admin', school_management_role: [] }
          : null,
      );
      staffRow('teacher');
      const err = await expectRejection(service.require('u1', 'course-1'));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('403 when the role is not in allowed', async () => {
      membership('member');
      staffRow('ta');
      const err = await expectRejection(
        service.require('u1', 'course-1', MANAGE_ROLES),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe(
        'Only the course teacher can do that in this course',
      );
    });

    test('a ta passes the default STAFF_ROLES check', async () => {
      membership('member');
      staffRow('ta');
      const { course, role } = await service.require('u1', 'course-1');
      expect(role).toBe('ta');
      expect(course.id).toBe('course-1');
      expect(course.created_at).toBe('2026-01-02T03:04:05.000Z');
    });

    test('teacher and admin pass MANAGE_ROLES', async () => {
      membership('teacher');
      staffRow('teacher');
      expect((await service.require('u1', 'course-1', MANAGE_ROLES)).role).toBe(
        'teacher',
      );

      cache._store.clear();
      membership('admin');
      staffRow(null);
      expect((await service.require('u1', 'course-1', MANAGE_ROLES)).role).toBe(
        'admin',
      );
    });

    test('an admin is 403 for an admin-excluding allow list', async () => {
      membership('admin');
      const err = await expectRejection(
        service.require('u1', 'course-1', ['teacher']),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
    });

    test('loads the course with COURSE_SELECT by id', async () => {
      membership('admin');
      await service.require('u1', 'course-1');
      const arg = prisma.course.findUnique.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'course-1' });
      expect(arg.select.is_template).toBe(true);
      expect(arg.select.school_id).toBe(true);
    });
  });

  describe('requireStudent', () => {
    const enrol = (status: string | null) =>
      prisma.course_student.findUnique.mockResolvedValue(
        status ? { status } : null,
      );

    test('returns the course for an active enrolment in a published course', async () => {
      enrol('active');
      const course = await service.requireStudent('s1', 'course-1');
      expect(course.id).toBe('course-1');
      expect(prisma.course_student.findUnique.mock.calls[0][0].where).toEqual({
        course_id_student_id: { course_id: 'course-1', student_id: 's1' },
      });
    });

    test('a completed enrolment still has access', async () => {
      enrol('completed');
      expect((await service.requireStudent('s1', 'course-1')).id).toBe(
        'course-1',
      );
    });

    test('404 when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      const err = await expectRejection(service.requireStudent('s1', 'x'));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('404 for a draft course, without reading the enrolment', async () => {
      prisma.course.findUnique.mockResolvedValue(dbCourse({ status: 'draft' }));
      enrol('active');
      const err = await expectRejection(service.requireStudent('s1', 'course-1'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.course_student.findUnique).not.toHaveBeenCalled();
    });

    test('an archived course is readable by default', async () => {
      prisma.course.findUnique.mockResolvedValue(dbCourse({ status: 'archived' }));
      enrol('active');
      expect((await service.requireStudent('s1', 'course-1')).status).toBe(
        'archived',
      );
    });

    test('an archived course is 404 with allowArchived: false', async () => {
      prisma.course.findUnique.mockResolvedValue(dbCourse({ status: 'archived' }));
      enrol('active');
      const err = await expectRejection(
        service.requireStudent('s1', 'course-1', { allowArchived: false }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('passing {} keeps the default: archived stays readable', async () => {
      prisma.course.findUnique.mockResolvedValue(dbCourse({ status: 'archived' }));
      enrol('active');
      await service.requireStudent('s1', 'course-1', {});
    });

    test('a published template is 404', async () => {
      prisma.course.findUnique.mockResolvedValue(dbCourse({ is_template: true }));
      enrol('active');
      const err = await expectRejection(service.requireStudent('s1', 'course-1'));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('404 when not enrolled', async () => {
      enrol(null);
      const err = await expectRejection(service.requireStudent('s1', 'course-1'));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('404 when the enrolment is dropped', async () => {
      enrol('dropped');
      const err = await expectRejection(service.requireStudent('s1', 'course-1'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Course not found');
    });
  });

  describe('courseIdOfActivity', () => {
    test('returns the activity course id', async () => {
      prisma.activity.findUnique.mockResolvedValue({ course_id: 'course-9' });
      expect(await service.courseIdOfActivity('a1')).toBe('course-9');
      expect(prisma.activity.findUnique.mock.calls[0][0]).toEqual({
        where: { id: 'a1' },
        select: { course_id: true },
      });
    });

    test('404 when the activity does not exist', async () => {
      const err = await expectRejection(service.courseIdOfActivity('a1'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Activity not found');
    });

    test('404 when the activity has no course', async () => {
      prisma.activity.findUnique.mockResolvedValue({ course_id: null });
      const err = await expectRejection(service.courseIdOfActivity('a1'));
      expect(err).toBeInstanceOf(NotFoundException);
    });
  });
});
