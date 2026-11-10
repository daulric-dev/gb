import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import {
  FAILED_JOIN_WINDOW_S,
  MAX_FAILED_JOINS,
  StudentPortalService,
} from './student-portal.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { HttpException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { AnnouncementService } from '@/announcement/announcement.service';

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
    created_at: new Date('2026-10-01'),
    updated_at: new Date('2026-10-01'),
    ...over,
  };
}

const GRADE = { percent: 80, letter: 'A', groups: [], dropped: [] };

/**
 * Course access, modules and pages are their own services (tested there);
 * these stand-ins keep their portal-facing rules: a draft course or a
 * dropped enrolment is a 404, and so is an unpublished page.
 */
function service(
  prisma: MockPrisma,
  opts: {
    joinByCode?: (...a: any[]) => any;
    summary?: () => any;
    course?: Record<string, any>;
    enrolment?: string;
    page?: Record<string, any>;
    cache?: ReturnType<typeof createMockCacheService>;
  } = {},
) {
  const access = {
    requireStudent: async (_s: string, courseId: string) => {
      const c = course({ id: courseId, ...opts.course });
      const enrolment = opts.enrolment ?? 'active';
      if (
        !['published', 'archived'].includes(c.status) ||
        !['active', 'completed'].includes(enrolment)
      ) {
        throw new NotFoundException('Course not found');
      }
      return c;
    },
  };
  const courses = {
    joinByCode: opts.joinByCode ?? (async () => ({ id: 'course-1' })),
  };
  const modules = { listForStudent: async () => [] };
  const pages = {
    getPublished: async () => {
      if (!opts.page?.is_published) {
        throw new NotFoundException('Page not found');
      }
      return opts.page;
    },
  };
  const announcements = { findForStudent: async () => [] };
  const gradebook = {
    studentSummary: opts.summary ?? (async () => GRADE),
  };
  const files = {
    readContentForAuthorisedCaller: async (id: string) => ({
      buffer: Buffer.from('bytes'),
      contentType: 'application/pdf',
      filename: `${id}.pdf`,
    }),
  };
  return new StudentPortalService(
    prisma as any,
    access as any,
    courses as any,
    modules as any,
    pages as any,
    announcements as any,
    gradebook as any,
    files as any,
    (opts.cache ?? createMockCacheService()) as any,
  );
}

describe('StudentPortalService.getMe', () => {
  test('returns the student and school, scoped to the resolved id', async () => {
    const prisma = createMockPrisma();
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1',
      first_name: 'Sam',
      last_name: 'Self',
      date_of_birth: new Date('2010-04-05T00:00:00Z'),
      gender: null,
      enrollment_date: null,
    });
    prisma.school.findUnique.mockResolvedValue({
      id: 'school-1',
      name: 'S',
      school_type: 'secondary',
      logo_path: null,
    });

    const me = await service(prisma).getMe(CTX);
    expect(me.firstName).toBe('Sam');
    expect(me.dateOfBirth).toBe('2010-04-05');
    expect(me.enrollmentDate).toBeNull();
    expect(me.school).toEqual({
      id: 'school-1',
      name: 'S',
      type: 'secondary',
      logoUrl: null,
    });
    expect('classes' in me).toBe(false);

    const call = prisma.student.findUnique.mock.calls[0][0];
    expect(call.where.id).toBe('student-1');
  });

  test('a missing record is a 404', async () => {
    const prisma = createMockPrisma();
    prisma.student.findUnique.mockResolvedValue(null);
    expect(await expectRejection(service(prisma).getMe(CTX))).toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('StudentPortalService courses', () => {
  const tables = (prisma: MockPrisma) => {
    prisma.course_student.findMany.mockResolvedValue([
      { course_id: 'course-1', status: 'active' },
    ]);
    prisma.course.findMany.mockResolvedValue([course()]);
    prisma.course_staff.findMany.mockResolvedValue([
      { course_id: 'course-1', user_profile_id: 'teacher-1' },
    ]);
    prisma.user_profile.findMany.mockResolvedValue([
      { id: 'teacher-1', first_name: 'Tess', last_name: 'Teach' },
    ]);
    return prisma;
  };

  test('lists cards with teachers and grade, never the join code', async () => {
    const prisma = tables(createMockPrisma());
    const cards = await service(prisma).listCourses(CTX);

    expect(cards).toEqual([
      {
        id: 'course-1',
        name: 'Maths',
        code: 'MAT',
        description: null,
        status: 'published',
        termId: 'term-1',
        bannerColor: null,
        bannerImageUrl: null,
        teachers: [{ firstName: 'Tess', lastName: 'Teach' }],
        grade: GRADE,
      },
    ]);
    expect(JSON.stringify(cards)).not.toContain('SECRET');

    const enrol = prisma.course_student.findMany.mock.calls[0][0];
    expect(enrol.where.student_id).toBe('student-1');
    expect(enrol.where.status).toEqual({ not: 'dropped' });
    const staff = prisma.course_staff.findMany.mock.calls[0][0];
    expect(staff.where.role).toBe('teacher');
  });

  test('cards carry the banner colour and cover image URL', async () => {
    const prisma = tables(createMockPrisma());
    const name = `course-banners/course-1-${'a'.repeat(32)}.png`;
    prisma.course.findMany.mockResolvedValue([
      course({ banner_color: 'teal', banner_image_path: name }),
    ]);
    const [card] = await service(prisma).listCourses(CTX);

    expect(card.bannerColor).toBe('teal');
    expect(card.bannerImageUrl).toEndWith(`/images/${name}`);
    const select = prisma.course.findMany.mock.calls[0][0].select;
    expect(select.banner_color).toBe(true);
    expect(select.banner_image_path).toBe(true);
  });

  test('a grade that fails to compute leaves the card without one', async () => {
    const prisma = tables(createMockPrisma());
    const cards = await service(prisma, {
      summary: async () => {
        throw new Error('boom');
      },
    }).listCourses(CTX);
    expect(cards[0].grade).toBeNull();
  });

  test('no enrolments means no courses and no course query', async () => {
    const prisma = createMockPrisma();
    prisma.course_student.findMany.mockResolvedValue([]);
    expect(await service(prisma).listCourses(CTX)).toEqual([]);
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  test('a draft course is hidden even when enrolled', async () => {
    const prisma = tables(createMockPrisma());
    expect(
      await expectRejection(
        service(prisma, { course: { status: 'draft' } }).getCourse(
          CTX,
          'course-1',
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a dropped student cannot open the course', async () => {
    const prisma = tables(createMockPrisma());
    expect(
      await expectRejection(
        service(prisma, { enrolment: 'dropped' }).getModules(CTX, 'course-1'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('joining passes the guard-resolved student and school', async () => {
    const prisma = tables(createMockPrisma());
    const seen: any[] = [];
    const card = await service(prisma, {
      joinByCode: async (...args: any[]) => {
        seen.push(args);
        return { id: 'course-1' };
      },
    }).joinCourse(CTX, 'abc123');

    expect(seen).toEqual([['student-1', 'school-1', 'abc123']]);
    expect(card.id).toBe('course-1');
    expect('joinCode' in card).toBe(false);
  });

  test('wrong join codes count per student, across sessions', async () => {
    const prisma = tables(createMockPrisma());
    const cache = createMockCacheService();
    const wrong = service(prisma, {
      cache,
      joinByCode: async () => {
        throw new NotFoundException('No open course uses that code');
      },
    });
    for (let i = 0; i < MAX_FAILED_JOINS; i++) {
      expect(await expectRejection(wrong.joinCourse(CTX, 'NOPE'))).toBeInstanceOf(
        NotFoundException,
      );
    }
    expect(cache._store.get('student-portal:failed-join:student-1')).toEqual({
      value: MAX_FAILED_JOINS,
      ttl: FAILED_JOIN_WINDOW_S,
    });

    // Even the right code is refused once the limit is spent: the counter
    // is keyed by student, so a fresh sign-in does not reset it.
    const err = (await expectRejection(
      service(prisma, { cache }).joinCourse(CTX, 'RIGHT'),
    )) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.message).toContain('Too many wrong join codes');
  });

  test('a successful join does not count toward the limit', async () => {
    const prisma = tables(createMockPrisma());
    const cache = createMockCacheService();
    await service(prisma, { cache }).joinCourse(CTX, 'abc123');
    expect(cache._store.size).toBe(0);
  });

  test('an unpublished page is a 404 for students', async () => {
    const prisma = tables(createMockPrisma());
    expect(
      await expectRejection(
        service(prisma, {
          page: {
            id: 'page-1',
            course_id: 'course-1',
            title: 'Draft',
            is_published: false,
            body: 'secret',
          },
        }).getPage(CTX, 'course-1', 'page-1'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('StudentPortalService.getCourseFile', () => {
  test('a file linked from a published module item is served', async () => {
    const prisma = createMockPrisma();
    prisma.module_item.findFirst.mockResolvedValue({ id: 'item-1' });
    prisma.file_share.findFirst.mockResolvedValue(null);

    const out = await service(prisma).getCourseFile(CTX, 'course-1', 'file-1');
    expect(out.filename).toBe('file-1.pdf');

    const where = prisma.module_item.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      course_id: 'course-1',
      file_id: 'file-1',
      is_published: true,
      module: { is_published: true },
      file: { deleted_at: null },
    });
  });

  test('a file shared with the course is served', async () => {
    const prisma = createMockPrisma();
    prisma.module_item.findFirst.mockResolvedValue(null);
    prisma.file_share.findFirst.mockResolvedValue({ id: 'share-1' });

    const out = await service(prisma).getCourseFile(CTX, 'course-1', 'file-1');
    expect(out.contentType).toBe('application/pdf');
    expect(prisma.file_share.findFirst.mock.calls[0][0].where).toMatchObject({
      principal_type: 'course',
      principal_id: 'course-1',
      file: { deleted_at: null },
    });
  });

  test('a file the course does not offer is a 404', async () => {
    const prisma = createMockPrisma();
    prisma.module_item.findFirst.mockResolvedValue(null);
    prisma.file_share.findFirst.mockResolvedValue(null);
    expect(
      await expectRejection(
        service(prisma).getCourseFile(CTX, 'course-1', 'file-1'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a dropped student cannot open course files', async () => {
    const prisma = createMockPrisma();
    prisma.module_item.findFirst.mockResolvedValue({ id: 'item-1' });
    expect(
      await expectRejection(
        service(prisma, { enrolment: 'dropped' }).getCourseFile(
          CTX,
          'course-1',
          'file-1',
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('StudentPortalService.getSchoolAnnouncements', () => {
  /** School posts as the table holds them; findMany applies `where`. */
  const ROWS = [
    { id: 'staff-only', school_id: 'school-1', course_id: null, audience: 'staff' },
    { id: 'for-all', school_id: 'school-1', course_id: null, audience: 'everyone' },
    { id: 'course-post', school_id: 'school-1', course_id: 'course-1', audience: 'staff' },
    { id: 'other-school', school_id: 'school-2', course_id: null, audience: 'everyone' },
  ].map((r) => ({
    ...r,
    title: r.id,
    body: null,
    created_at: new Date('2026-11-01'),
    updated_at: null,
    user_profile: null,
  }));

  function portal(prisma: MockPrisma) {
    const announcements = new AnnouncementService(
      prisma as any,
      createMockCacheService() as any,
      {} as any,
    );
    return new StudentPortalService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      announcements,
      {} as any,
      {} as any,
      createMockCacheService() as any,
    );
  }

  test("only the student's own school's posts for everyone", async () => {
    const prisma = createMockPrisma();
    prisma.announcement.findMany.mockImplementation(async ({ where }: any) =>
      ROWS.filter((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      ),
    );
    const svc = portal(prisma);
    expect((await svc.getSchoolAnnouncements(CTX)).map((a) => a.id)).toEqual([
      'for-all',
    ]);
    expect(
      (
        await svc.getSchoolAnnouncements({ studentId: 's-2', schoolId: 'school-2' })
      ).map((a) => a.id),
    ).toEqual(['other-school']);
  });
});
