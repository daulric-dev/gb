import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { CourseService } from './course.service';
import { CourseAccessService } from './access/course-access.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

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
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

/**
 * A database where the caller is a member of school-1 with the given school
 * role and, optionally, a role on the course.
 */
function db(opts: {
  schoolRole?: 'admin' | 'teacher' | 'member' | null;
  courseRole?: 'teacher' | 'ta' | null;
}): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.school_management.findFirst.mockResolvedValue(
    opts.schoolRole === null
      ? null
      : { role: opts.schoolRole ?? 'teacher', school_management_role: [] },
  );
  prisma.course_staff.findUnique.mockResolvedValue(
    opts.courseRole ? { role: opts.courseRole } : null,
  );
  prisma.course_staff.findMany.mockResolvedValue(
    opts.courseRole ? [{ course_id: COURSE, role: opts.courseRole }] : [],
  );
  prisma.course.findUnique.mockResolvedValue(courseRow());
  prisma.course.findFirst.mockResolvedValue(courseRow());
  prisma.course.findMany.mockResolvedValue([courseRow()]);
  prisma.course.create.mockResolvedValue(courseRow());
  prisma.course.update.mockResolvedValue(courseRow());
  return prisma;
}

function service(prisma: MockPrisma) {
  const cache = createMockCacheService() as any;
  return new CourseService(
    cache,
    new CourseAccessService(cache, prisma as any),
    prisma as any,
  );
}

describe('CourseService.create', () => {
  test('the creator becomes the course teacher', async () => {
    const prisma = db({});
    const created = await service(prisma).create(USER, { name: '  Maths  ' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.course.create.mock.calls[0][0].data).toMatchObject({
      school_id: 'school-1',
      name: 'Maths',
      created_by: USER,
    });
    expect(prisma.course_staff.create.mock.calls[0][0].data).toEqual({
      course_id: COURSE,
      user_profile_id: USER,
      role: 'teacher',
    });
    expect(created.role).toBe('teacher');
    expect(created.studentCount).toBe(0);
    expect(created.createdAt).toBe('2026-10-01T00:00:00.000Z');
  });

  test('a blank name is refused', async () => {
    const prisma = db({});
    expect(
      await expectRejection(service(prisma).create(USER, { name: '   ' })),
    ).toBeInstanceOf(BadRequestException);
  });

  test('no school is refused', async () => {
    const prisma = db({});
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: null });
    expect(
      await expectRejection(service(prisma).create(USER, { name: 'Maths' })),
    ).toBeInstanceOf(BadRequestException);
  });

  test('a failed teacher insert fails the whole create', async () => {
    const prisma = db({});
    prisma.course_staff.create.mockRejectedValue(new Error('nope'));
    expect(
      await expectRejection(service(prisma).create(USER, { name: 'Maths' })),
    ).toBeInstanceOf(BadRequestException);
    // Both writes run in one transaction, so the course is rolled back.
    expect(prisma.course.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('CourseService.list', () => {
  test('a teacher with no courses gets none, without a course query', async () => {
    const prisma = db({ courseRole: null });
    expect(await service(prisma).list(USER, {})).toEqual([]);
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  test('a teacher sees their courses with their role', async () => {
    const prisma = db({ courseRole: 'ta' });
    prisma.course_student.groupBy.mockResolvedValue([
      { course_id: COURSE, _count: { _all: 2 } },
    ]);
    const [c] = await service(prisma).list(USER, {});
    expect(c.role).toBe('ta');
    expect(c.studentCount).toBe(2);
    expect(prisma.course.findMany.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      id: { in: [COURSE] },
    });
  });

  test('a school admin sees every course as admin', async () => {
    const prisma = db({ schoolRole: 'admin', courseRole: null });
    const [c] = await service(prisma).list(USER, { status: 'published' });
    expect(c.role).toBe('admin');
    expect(prisma.course.findMany.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      status: 'published',
    });
  });

  test('a failed query is a 400', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course.findMany.mockRejectedValue(new Error('boom'));
    expect(
      await expectRejection(service(prisma).list(USER, {})),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe('course roles', () => {
  test('someone with no role in the course gets a 404', async () => {
    const prisma = db({ courseRole: null });
    expect(
      await expectRejection(service(prisma).get(USER, COURSE)),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a missing course is a 404', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course.findUnique.mockResolvedValue(null);
    expect(
      await expectRejection(service(prisma).get(USER, COURSE)),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a TA can read but not change settings', async () => {
    const prisma = db({ courseRole: 'ta' });
    const svc = service(prisma);
    expect((await svc.get(USER, COURSE)).role).toBe('ta');
    expect(
      await expectRejection(svc.update(USER, COURSE, { name: 'X' })),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('course staff removed from the school lose access', async () => {
    const prisma = db({ schoolRole: null, courseRole: 'teacher' });
    expect(
      await expectRejection(service(prisma).get(USER, COURSE)),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('join codes', () => {
  test('regenerating stores a 6-character code without ambiguous letters', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const { joinCode } = await service(prisma).regenerateJoinCode(USER, COURSE);
    expect(joinCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(prisma.course.updateMany.mock.calls[0][0].data.join_code).toBe(
      joinCode,
    );
  });

  test('a clashing code is retried', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const clash = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.course.updateMany
      .mockRejectedValueOnce(clash)
      .mockResolvedValueOnce({ count: 1 });
    await service(prisma).regenerateJoinCode(USER, COURSE);
    expect(prisma.course.updateMany).toHaveBeenCalledTimes(2);
  });

  test('joining upper-cases the code and enrols the student as active', async () => {
    const prisma = db({});
    const course = await service(prisma).joinByCode(
      'student-1',
      'school-1',
      ' abc234 ',
    );

    expect(prisma.course.findFirst.mock.calls[0][0].where).toEqual({
      join_code: 'ABC234',
      school_id: 'school-1',
      status: 'published',
      is_template: false,
    });
    const upsert = prisma.course_student.upsert.mock.calls[0][0];
    expect(upsert.create).toEqual({
      course_id: COURSE,
      student_id: 'student-1',
      status: 'active',
    });
    expect(upsert.update).toEqual({ status: 'active' });
    expect(course.id).toBe(COURSE);
  });

  test('an unknown code is a 404', async () => {
    const prisma = db({});
    prisma.course.findFirst.mockResolvedValue(null);
    expect(
      await expectRejection(
        service(prisma).joinByCode('s', 'school-1', 'NOPE'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('people', () => {
  test('maps staff and students to the API shape', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course_staff.findMany.mockResolvedValue([
      {
        user_profile_id: 'u2',
        role: 'ta',
        user_profile: { first_name: 'T', last_name: 'A', email: 'ta@x', avatar_url: null },
      },
      {
        user_profile_id: USER,
        role: 'teacher',
        user_profile: { first_name: 'Te', last_name: 'Acher', email: 't@x', avatar_url: 'a.png' },
      },
    ]);
    prisma.course_student.findMany.mockResolvedValue([
      {
        student_id: 's1',
        status: 'active',
        enrolled_at: new Date('2026-10-02T10:00:00Z'),
        student: { first_name: 'Ann', last_name: 'Zed', user_profile_id: null },
      },
    ]);
    const people = await service(prisma).people(USER, COURSE);
    expect(people.staff.map((s) => s.role)).toEqual(['teacher', 'ta']);
    expect(people.staff[0]).toEqual({
      userProfileId: USER,
      role: 'teacher',
      firstName: 'Te',
      lastName: 'Acher',
      email: 't@x',
      avatarUrl: 'a.png',
    });
    expect(people.students).toEqual([
      {
        studentId: 's1',
        status: 'active',
        enrolledAt: '2026-10-02T10:00:00.000Z',
        firstName: 'Ann',
        lastName: 'Zed',
        hasAccount: false,
      },
    ]);
  });
});

describe('staff', () => {
  test('changing the role of someone not on the course is a 404', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course_staff.updateMany.mockResolvedValue({ count: 0 });
    expect(
      await expectRejection(
        service(prisma).updateStaff(USER, COURSE, 'u9', 'teacher'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('the last teacher cannot be removed', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course_staff.findMany.mockResolvedValue([{ user_profile_id: USER }]);
    const err = await expectRejection(
      service(prisma).removeStaff(USER, COURSE, USER),
    );
    expect((err as Error).message).toBe('A course needs at least one teacher');
    expect(prisma.course_staff.deleteMany).not.toHaveBeenCalled();
  });

  test('a student account cannot be added as staff', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.user_profile.findUnique.mockImplementation(async (args: any) =>
      args.select.account_type
        ? { account_type: 'student' }
        : { school_id: 'school-1' },
    );
    expect(
      await expectRejection(
        service(prisma).addStaff(USER, COURSE, { userProfileId: 'u2', role: 'ta' }),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('enrolment', () => {
  test('enrols only students of the course school', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.student.findMany.mockResolvedValue([{ id: 's1' }]);
    expect(
      await expectRejection(
        service(prisma).enrollStudents(USER, COURSE, ['s1', 's2']),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('enrols the given students as active, de-duplicated', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.student.findMany.mockResolvedValue([{ id: 's1' }]);
    const result = await service(prisma).enrollStudents(USER, COURSE, [
      's1',
      's1',
    ]);
    expect(result).toEqual({ enrolled: 1 });

    expect(prisma.course_student.createMany.mock.calls[0][0]).toEqual({
      data: [{ course_id: COURSE, student_id: 's1', status: 'active' }],
      skipDuplicates: true,
    });
    // Re-enrolling revives a dropped student.
    expect(prisma.course_student.updateMany.mock.calls[0][0]).toEqual({
      where: { course_id: COURSE, student_id: { in: ['s1'] } },
      data: { status: 'active' },
    });
  });

  test('a TA cannot enrol students', async () => {
    const prisma = db({ courseRole: 'ta' });
    expect(
      await expectRejection(service(prisma).enrollStudents(USER, COURSE, ['s1'])),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a student with work is dropped rather than deleted', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.submission.count.mockResolvedValue(1);
    await service(prisma).removeStudent(USER, COURSE, 's1');
    expect(prisma.course_student.updateMany.mock.calls[0][0]).toEqual({
      where: { course_id: COURSE, student_id: 's1' },
      data: { status: 'dropped' },
    });
    expect(prisma.course_student.deleteMany).not.toHaveBeenCalled();
  });

  test('a student without work is removed', async () => {
    const prisma = db({ courseRole: 'teacher' });
    await service(prisma).removeStudent(USER, COURSE, 's1');
    expect(prisma.course_student.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('remove', () => {
  test('a course with hand-ins must be archived first', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.submission.count.mockResolvedValue(3);
    const err = await expectRejection(service(prisma).remove(USER, COURSE));
    expect((err as Error).message).toContain('archive the course');
    expect(prisma.course.deleteMany).not.toHaveBeenCalled();
  });
});

describe('templates', () => {
  test('a course with students cannot become a template', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course_student.count.mockResolvedValue(2);
    const err = await expectRejection(
      service(prisma).update(USER, COURSE, { isTemplate: true }),
    );
    expect((err as Error).message).toContain('Remove the students');
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  test('becoming a template turns the join code off', async () => {
    const prisma = db({ courseRole: 'teacher' });
    await service(prisma).update(USER, COURSE, { isTemplate: true });
    expect(prisma.course.update.mock.calls[0][0].data).toMatchObject({
      is_template: true,
      join_code: null,
    });
  });

  test('a template takes no enrolments', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course.findUnique.mockResolvedValue(courseRow({ is_template: true }));
    const err = await expectRejection(
      service(prisma).enrollStudents(USER, COURSE, ['s1']),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.course_student.createMany).not.toHaveBeenCalled();
  });
});
