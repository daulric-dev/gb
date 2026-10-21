import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PageService } from './page.service';
import { STAFF_ROLES, type CourseRole } from './access/course-access.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

const USER = 'user-1';
const COURSE = 'course-1';

function fakeAccess(role: CourseRole | null) {
  return {
    require: async (
      _u: string,
      _c: string,
      allowed: readonly CourseRole[] = STAFF_ROLES,
    ) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!allowed.includes(role)) throw new ForbiddenException('no');
      return { course: { id: COURSE, school_id: 'school-1' }, role };
    },
  } as any;
}

function page(over: Record<string, any> = {}) {
  return {
    id: 'p1',
    course_id: COURSE,
    title: 'Welcome',
    is_published: true,
    updated_at: '2026-10-02',
    body: '# Hi',
    created_by: USER,
    created_at: '2026-10-01',
    ...over,
  };
}

describe('PageService', () => {
  test('list returns summaries without bodies', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.page': { data: [page()], error: null } },
    });
    const pages = await new PageService(sb as any, fakeAccess('ta')).list(
      USER,
      COURSE,
    );
    expect(pages).toEqual([
      {
        id: 'p1',
        courseId: COURSE,
        title: 'Welcome',
        isPublished: true,
        updatedAt: '2026-10-02',
      },
    ]);
  });

  test('get is scoped to the course and returns the full page', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.page': { data: page(), error: null } },
    });
    const got = await new PageService(sb as any, fakeAccess('ta')).get(
      USER,
      COURSE,
      'p1',
    );
    expect(got.body).toBe('# Hi');
    expect(got.createdBy).toBe(USER);
    const call = sb._calls.find((c: any) => c.table === 'page');
    expect(call?.filters).toMatchObject({ id: 'p1', course_id: COURSE });
  });

  test('a TA cannot write pages', async () => {
    const sb = createRoutingSupabase({});
    const svc = new PageService(sb as any, fakeAccess('ta'));
    expect(
      await expectRejection(svc.create(USER, COURSE, { title: 'X' })),
    ).toBeInstanceOf(ForbiddenException);
    expect(
      await expectRejection(svc.remove(USER, COURSE, 'p1')),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('create trims the title and defaults to an empty draft', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.page': { data: page({ is_published: false, body: '' }), error: null } },
    });
    await new PageService(sb as any, fakeAccess('teacher')).create(USER, COURSE, {
      title: '  Welcome ',
    });
    const insert = sb._calls.find((c: any) => c.op === 'insert');
    expect(insert?.payload).toEqual({
      course_id: COURSE,
      title: 'Welcome',
      body: '',
      is_published: false,
      created_by: USER,
    });
  });

  test('an empty update is refused', async () => {
    const sb = createRoutingSupabase({});
    expect(
      await expectRejection(
        new PageService(sb as any, fakeAccess('teacher')).update(
          USER,
          COURSE,
          'p1',
          {},
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('updating a page of another course is a 404', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.page': { data: null, error: null } },
    });
    expect(
      await expectRejection(
        new PageService(sb as any, fakeAccess('teacher')).update(
          USER,
          COURSE,
          'p9',
          { title: 'X' },
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('getPublished hides drafts', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.page': { data: page({ is_published: false }), error: null } },
    });
    expect(
      await expectRejection(
        new PageService(sb as any, fakeAccess(null)).getPublished(COURSE, 'p1'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});
