import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { StudentPortalService } from './student-portal.service';
import { CourseAccessService } from '@/course/access/course-access.service';
import { ModuleService } from '@/course/module.service';
import { PageService } from '@/course/page.service';
import {
  createMockCacheService,
  createRoutingSupabase,
  expectRejection,
} from '@/test/mocks';

const CTX = { studentId: 'student-1', schoolId: 'school-1' };

function course(over: Record<string, any> = {}) {
  return {
    id: 'course-1',
    school_id: 'school-1',
    academic_year_id: null,
    term_id: 'term-1',
    name: 'Maths',
    code: 'MAT',
    description: null,
    status: 'published',
    join_code: 'SECRET',
    grade_scale_id: null,
    created_by: 'teacher-1',
    created_at: '2026-10-01',
    updated_at: '2026-10-01',
    ...over,
  };
}

const GRADE = { percent: 80, letter: 'A', groups: [] };

function service(
  sb: any,
  opts: { joinByCode?: (...a: any[]) => any; summary?: () => any } = {},
) {
  const access = new CourseAccessService(sb, createMockCacheService() as any);
  const courses = {
    joinByCode: opts.joinByCode ?? (async () => ({ id: 'course-1' })),
  };
  const announcements = { findForStudent: async () => [] };
  const gradebook = {
    studentSummary: opts.summary ?? (async () => GRADE),
  };
  return new StudentPortalService(
    sb,
    access,
    courses as any,
    new ModuleService(sb, access),
    new PageService(sb, access),
    announcements as any,
    gradebook as any,
  );
}

describe('StudentPortalService.getMe', () => {
  test('returns the student and school, scoped to the resolved id', async () => {
    const sb = createRoutingSupabase({
      tables: {
        'student.student': {
          data: { id: 'student-1', first_name: 'Sam', last_name: 'Self' },
          error: null,
        },
        school: {
          data: { id: 'school-1', name: 'S', school_type: 'secondary' },
          error: null,
        },
      },
    });

    const me = await service(sb).getMe(CTX);
    expect(me.firstName).toBe('Sam');
    expect(me.school).toEqual({ id: 'school-1', name: 'S', type: 'secondary' });
    expect('classes' in me).toBe(false);

    const call = sb._calls.find((c: any) => c.table === 'student');
    expect(call?.filters.id).toBe('student-1');
  });

  test('a missing record is a 404', async () => {
    const sb = createRoutingSupabase({
      tables: { 'student.student': { data: null, error: null } },
    });
    expect(await expectRejection(service(sb).getMe(CTX))).toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StudentPortalService courses', () => {
  const tables = (over: Record<string, any> = {}) => ({
    'course.course_student': (call: any) =>
      call.filters.course_id
        ? { data: { status: 'active' }, error: null }
        : { data: [{ course_id: 'course-1', status: 'active' }], error: null },
    'course.course': (call: any) =>
      call.filters.id
        ? { data: course(), error: null }
        : { data: [course()], error: null },
    'course.course_staff': {
      data: [{ course_id: 'course-1', user_profile_id: 'teacher-1' }],
      error: null,
    },
    user_profile: {
      data: [{ id: 'teacher-1', first_name: 'Tess', last_name: 'Teach' }],
      error: null,
    },
    ...over,
  });

  test('lists cards with teachers and grade, never the join code', async () => {
    const sb = createRoutingSupabase({ tables: tables() });
    const cards = await service(sb).listCourses(CTX);

    expect(cards).toEqual([
      {
        id: 'course-1',
        name: 'Maths',
        code: 'MAT',
        description: null,
        status: 'published',
        termId: 'term-1',
        teachers: [{ firstName: 'Tess', lastName: 'Teach' }],
        grade: GRADE,
      },
    ]);
    expect(JSON.stringify(cards)).not.toContain('SECRET');

    const enrol = sb._calls.find((c: any) => c.table === 'course_student');
    expect(enrol?.filters.student_id).toBe('student-1');
  });

  test('a grade that fails to compute leaves the card without one', async () => {
    const sb = createRoutingSupabase({ tables: tables() });
    const cards = await service(sb, {
      summary: async () => {
        throw new Error('boom');
      },
    }).listCourses(CTX);
    expect(cards[0].grade).toBeNull();
  });

  test('no enrolments means no courses and no course query', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.course_student': { data: [], error: null } },
    });
    expect(await service(sb).listCourses(CTX)).toEqual([]);
    expect(sb._calls.some((c: any) => c.table === 'course')).toBe(false);
  });

  test('a draft course is hidden even when enrolled', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        'course.course': { data: course({ status: 'draft' }), error: null },
      }),
    });
    expect(
      await expectRejection(service(sb).getCourse(CTX, 'course-1')),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a dropped student cannot open the course', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        'course.course_student': { data: { status: 'dropped' }, error: null },
      }),
    });
    expect(
      await expectRejection(service(sb).getModules(CTX, 'course-1')),
    ).toBeInstanceOf(NotFoundException);
  });

  test('joining passes the guard-resolved student and school', async () => {
    const sb = createRoutingSupabase({ tables: tables() });
    const seen: any[] = [];
    const card = await service(sb, {
      joinByCode: async (...args: any[]) => {
        seen.push(args);
        return { id: 'course-1' };
      },
    }).joinCourse(CTX, 'abc123');

    expect(seen).toEqual([['student-1', 'school-1', 'abc123']]);
    expect(card.id).toBe('course-1');
    expect('joinCode' in card).toBe(false);
  });

  test('an unpublished page is a 404 for students', async () => {
    const sb = createRoutingSupabase({
      tables: tables({
        'course.page': {
          data: {
            id: 'page-1',
            course_id: 'course-1',
            title: 'Draft',
            is_published: false,
            updated_at: 'x',
            body: 'secret',
          },
          error: null,
        },
      }),
    });
    expect(
      await expectRejection(service(sb).getPage(CTX, 'course-1', 'page-1')),
    ).toBeInstanceOf(NotFoundException);
  });
});
