import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseAccessService } from './access/course-access.service';
import {
  createMockCacheService,
  createRoutingSupabase,
  expectRejection,
} from '@/test/mocks';

const USER = 'user-1';
const COURSE = 'course-1';

function courseRow(over: Record<string, any> = {}) {
  return {
    id: COURSE,
    school_id: 'school-1',
    academic_year_id: null,
    term_id: null,
    name: 'Maths',
    code: 'MAT',
    description: null,
    status: 'published',
    join_code: 'ABC234',
    grade_scale_id: null,
    created_by: USER,
    created_at: '2026-10-01',
    updated_at: '2026-10-01',
    ...over,
  };
}

/**
 * Tables for a caller who is a member of school-1 with the given school role
 * and, optionally, a role on the course.
 */
function tables(opts: {
  schoolRole?: 'admin' | 'teacher' | 'member' | null;
  courseRole?: 'teacher' | 'ta' | null;
  extra?: Record<string, any>;
}) {
  return {
    school_management:
      opts.schoolRole === null
        ? { data: null, error: null }
        : { data: { id: 'm1', role: opts.schoolRole ?? 'teacher' }, error: null },
    school_management_role: { data: [], error: null },
    'course.course_staff': (call: any) =>
      call.filters.course_id && call.filters.user_profile_id
        ? {
            data: opts.courseRole ? { role: opts.courseRole } : null,
            error: null,
          }
        : {
            data: opts.courseRole
              ? [{ course_id: COURSE, role: opts.courseRole }]
              : [],
            error: null,
          },
    'course.course': (call: any) =>
      call.op === 'select' && !call.filters.id && !call.filters.join_code
        ? { data: [courseRow()], error: null }
        : { data: courseRow(), error: null },
    ...opts.extra,
  };
}

function service(sb: any) {
  const cache = createMockCacheService() as any;
  return new CourseService(sb, cache, new CourseAccessService(sb, cache));
}

describe('CourseService.create', () => {
  test('the creator becomes the course teacher', async () => {
    const sb = createRoutingSupabase({ tables: tables({}) });
    const created = await service(sb).create(USER, { name: '  Maths  ' });

    const insert = sb._calls.find(
      (c: any) => c.table === 'course' && c.op === 'insert',
    );
    expect(insert?.payload).toMatchObject({
      school_id: 'school-1',
      name: 'Maths',
      created_by: USER,
    });
    const staff = sb._calls.find(
      (c: any) => c.table === 'course_staff' && c.op === 'insert',
    );
    expect(staff?.payload).toEqual({
      course_id: COURSE,
      user_profile_id: USER,
      role: 'teacher',
    });
    expect(created.role).toBe('teacher');
    expect(created.studentCount).toBe(0);
  });

  test('a blank name is refused', async () => {
    const sb = createRoutingSupabase({ tables: tables({}) });
    expect(
      await expectRejection(service(sb).create(USER, { name: '   ' })),
    ).toBeInstanceOf(BadRequestException);
  });

  test('a failed teacher insert undoes the course', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        extra: {
          'course.course_staff': { data: null, error: { message: 'nope' } },
        },
      }),
    });
    expect(
      await expectRejection(service(sb).create(USER, { name: 'Maths' })),
    ).toBeInstanceOf(BadRequestException);
    expect(
      sb._calls.some((c: any) => c.table === 'course' && c.op === 'delete'),
    ).toBe(true);
  });
});

describe('CourseService.list', () => {
  test('a teacher with no courses gets none, without a course query', async () => {
    const sb = createRoutingSupabase({ tables: tables({ courseRole: null }) });
    expect(await service(sb).list(USER, {})).toEqual([]);
    expect(sb._calls.some((c: any) => c.table === 'course')).toBe(false);
  });

  test('a teacher sees their courses with their role', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        courseRole: 'ta',
        extra: {
          'course.course_student': {
            data: [{ course_id: COURSE }, { course_id: COURSE }],
            error: null,
          },
        },
      }),
    });
    const [c] = await service(sb).list(USER, {});
    expect(c.role).toBe('ta');
    expect(c.studentCount).toBe(2);
  });

  test('a school admin sees every course as admin', async () => {
    const sb = createRoutingSupabase({
      tables: tables({ schoolRole: 'admin', courseRole: null }),
    });
    const [c] = await service(sb).list(USER, {});
    expect(c.role).toBe('admin');
  });
});

describe('course roles', () => {
  test('someone with no role in the course gets a 404', async () => {
    const sb = createRoutingSupabase({ tables: tables({ courseRole: null }) });
    expect(await expectRejection(service(sb).get(USER, COURSE))).toBeInstanceOf(
      NotFoundException,
    );
  });

  test('a TA can read but not change settings', async () => {
    const sb = createRoutingSupabase({ tables: tables({ courseRole: 'ta' }) });
    const svc = service(sb);
    expect((await svc.get(USER, COURSE)).role).toBe('ta');
    expect(
      await expectRejection(svc.update(USER, COURSE, { name: 'X' })),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('course staff removed from the school lose access', async () => {
    const sb = createRoutingSupabase({
      tables: tables({ schoolRole: null, courseRole: 'teacher' }),
    });
    expect(await expectRejection(service(sb).get(USER, COURSE))).toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('join codes', () => {
  test('regenerating stores a 6-character code without ambiguous letters', async () => {
    const sb = createRoutingSupabase({ tables: tables({ courseRole: 'teacher' }) });
    const { joinCode } = await service(sb).regenerateJoinCode(USER, COURSE);
    expect(joinCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  test('joining upper-cases the code and enrols the student as active', async () => {
    const sb = createRoutingSupabase({ tables: tables({}) });
    const course = await service(sb).joinByCode('student-1', 'school-1', ' abc234 ');

    const lookup = sb._calls.find(
      (c: any) => c.table === 'course' && c.filters.join_code,
    );
    expect(lookup?.filters).toMatchObject({
      join_code: 'ABC234',
      school_id: 'school-1',
      status: 'published',
    });
    const upsert = sb._calls.find((c: any) => c.table === 'course_student');
    expect(upsert?.payload).toEqual({
      course_id: COURSE,
      student_id: 'student-1',
      status: 'active',
    });
    expect(course.id).toBe(COURSE);
  });

  test('an unknown code is a 404', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.course': { data: null, error: null } },
    });
    expect(
      await expectRejection(service(sb).joinByCode('s', 'school-1', 'NOPE')),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('enrolment', () => {
  test('enrols only students of the course school', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        courseRole: 'teacher',
        extra: {
          'student.student': { data: [{ id: 's1' }], error: null },
        },
      }),
    });
    expect(
      await expectRejection(
        service(sb).enrollStudents(USER, COURSE, ['s1', 's2']),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('enrols the given students as active, de-duplicated', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        courseRole: 'teacher',
        extra: {
          'student.student': { data: [{ id: 's1' }], error: null },
        },
      }),
    });
    const result = await service(sb).enrollStudents(USER, COURSE, ['s1', 's1']);
    expect(result).toEqual({ enrolled: 1 });

    const upsert = sb._calls.find((c: any) => c.table === 'course_student');
    expect(upsert?.payload).toEqual([
      { course_id: COURSE, student_id: 's1', status: 'active' },
    ]);
  });

  test('a TA cannot enrol students', async () => {
    const sb = createRoutingSupabase({ tables: tables({ courseRole: 'ta' }) });
    expect(
      await expectRejection(service(sb).enrollStudents(USER, COURSE, ['s1'])),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a student with work is dropped rather than deleted', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        courseRole: 'teacher',
        extra: {
          'grading.activity': { data: [{ id: 'a1' }], error: null },
          'grading.submission': { data: null, error: null, count: 1 } as any,
        },
      }),
    });
    await service(sb).removeStudent(USER, COURSE, 's1');
    const write = sb._calls.find((c: any) => c.table === 'course_student');
    expect(write?.op).toBe('update');
    expect(write?.payload).toEqual({ status: 'dropped' });
  });
});
