import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { StudentPortalService } from './student-portal.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

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
    });

    const me = await service(prisma).getMe(CTX);
    expect(me.firstName).toBe('Sam');
    expect(me.dateOfBirth).toBe('2010-04-05');
    expect(me.enrollmentDate).toBeNull();
    expect(me.school).toEqual({ id: 'school-1', name: 'S', type: 'secondary' });
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
