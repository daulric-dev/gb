import { describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PageService } from './page.service';
import { STAFF_ROLES, type CourseRole } from './access/course-access.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

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
    updated_at: new Date('2026-10-02T09:00:00Z'),
    body: '# Hi',
    created_by: USER,
    created_at: new Date('2026-10-01T09:00:00Z'),
    ...over,
  };
}

describe('PageService', () => {
  test('list returns summaries without bodies', async () => {
    const prisma = createMockPrisma();
    prisma.page.findMany.mockResolvedValue([
      {
        id: 'p1',
        course_id: COURSE,
        title: 'Welcome',
        is_published: true,
        updated_at: new Date('2026-10-02T09:00:00Z'),
      },
    ]);
    const pages = await new PageService(prisma as any, fakeAccess('ta')).list(
      USER,
      COURSE,
    );
    expect(pages).toEqual([
      {
        id: 'p1',
        courseId: COURSE,
        title: 'Welcome',
        isPublished: true,
        updatedAt: '2026-10-02T09:00:00.000Z',
      },
    ]);
    expect(prisma.page.findMany.mock.calls[0][0].orderBy).toEqual({
      title: 'asc',
    });
  });

  test('get is scoped to the course and returns the full page', async () => {
    const prisma = createMockPrisma();
    prisma.page.findFirst.mockResolvedValue(page());
    const got = await new PageService(prisma as any, fakeAccess('ta')).get(
      USER,
      COURSE,
      'p1',
    );
    expect(got).toEqual({
      id: 'p1',
      courseId: COURSE,
      title: 'Welcome',
      isPublished: true,
      updatedAt: '2026-10-02T09:00:00.000Z',
      body: '# Hi',
      createdBy: USER,
      createdAt: '2026-10-01T09:00:00.000Z',
    });
    expect(prisma.page.findFirst.mock.calls[0][0].where).toEqual({
      id: 'p1',
      course_id: COURSE,
    });
  });

  test('a TA cannot write pages', async () => {
    const prisma = createMockPrisma();
    const svc = new PageService(prisma as any, fakeAccess('ta'));
    expect(
      await expectRejection(svc.create(USER, COURSE, { title: 'X' })),
    ).toBeInstanceOf(ForbiddenException);
    expect(
      await expectRejection(svc.remove(USER, COURSE, 'p1')),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('create trims the title and defaults to an empty draft', async () => {
    const prisma = createMockPrisma();
    prisma.page.create.mockResolvedValue(
      page({ is_published: false, body: '' }),
    );
    const auditLog = { record: mock(async (..._args: any[]) => {}) };
    await new PageService(
      prisma as any,
      fakeAccess('teacher'),
      auditLog as any,
    ).create(USER, COURSE, { title: '  Welcome ' });
    expect(prisma.page.create.mock.calls[0][0].data).toEqual({
      course_id: COURSE,
      title: 'Welcome',
      body: '',
      is_published: false,
      created_by: USER,
    });
    const [tx, schoolId, actor, entry] = auditLog.record.mock.calls[0];
    expect(tx).toBe(prisma);
    expect([schoolId, actor, entry]).toEqual([
      'school-1',
      { id: USER },
      {
        entity: 'page',
        entityId: 'p1',
        action: 'create',
        changes: {
          title: { before: null, after: 'Welcome' },
          body: { before: null, after: '' },
          is_published: { before: null, after: false },
        },
      },
    ]);
  });

  test('an empty update is refused', async () => {
    const prisma = createMockPrisma();
    expect(
      await expectRejection(
        new PageService(prisma as any, fakeAccess('teacher')).update(
          USER,
          COURSE,
          'p1',
          {},
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('update audits only changed page fields in its write transaction', async () => {
    const prisma = createMockPrisma();
    prisma.page.findFirst.mockResolvedValue(page());
    prisma.page.updateManyAndReturn.mockResolvedValue([
      page({ title: 'Updated', body: '# Hi', is_published: true }),
    ]);
    const auditLog = { record: mock(async (..._args: any[]) => {}) };

    await new PageService(
      prisma as any,
      fakeAccess('teacher'),
      auditLog as any,
    ).update(USER, COURSE, 'p1', { title: ' Updated ' });

    const [tx, schoolId, actor, entry] = auditLog.record.mock.calls[0];
    expect(tx).toBe(prisma);
    expect([schoolId, actor, entry]).toEqual([
      'school-1',
      { id: USER },
      {
        entity: 'page',
        entityId: 'p1',
        action: 'update',
        changes: { title: { before: 'Welcome', after: 'Updated' } },
      },
    ]);
  });

  test('updating a page of another course is a 404', async () => {
    const prisma = createMockPrisma();
    expect(
      await expectRejection(
        new PageService(prisma as any, fakeAccess('teacher')).update(
          USER,
          COURSE,
          'p9',
          { title: 'X' },
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
    expect(prisma.page.findFirst.mock.calls[0][0].where).toEqual({
      id: 'p9',
      course_id: COURSE,
    });
    expect(prisma.page.updateManyAndReturn).not.toHaveBeenCalled();
  });

  test('deleting a page of another course is a 404', async () => {
    const prisma = createMockPrisma();
    prisma.page.deleteMany.mockResolvedValue({ count: 0 });
    expect(
      await expectRejection(
        new PageService(prisma as any, fakeAccess('teacher')).remove(
          USER,
          COURSE,
          'p9',
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('getPublished hides drafts', async () => {
    const prisma = createMockPrisma();
    prisma.page.findFirst.mockResolvedValue(page({ is_published: false }));
    expect(
      await expectRejection(
        new PageService(prisma as any, fakeAccess(null)).getPublished(
          COURSE,
          'p1',
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});
