import { describe, test, expect } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityService } from './activity.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/**
 * Activities keyed to courses.
 *
 * Access is the caller's course role (CourseAccessService, stubbed here), so
 * these pin which role each operation asks for and the course-scoped checks
 * the service adds on top: groups must be the course's own, offline work
 * accepts nothing, and publishing no longer touches the old gradebook.
 */

const ACTIVITY = {
  id: 'act-1',
  course_id: 'course-1',
  assignment_group_id: null,
  kind: 'assignment',
  title: 'Essay',
  instructions: null,
  points: 20,
  due_at: null,
  status: 'draft',
  published_at: null,
  allow_file: true,
  allow_multiple_files: false,
  allow_text: true,
  max_attempts: 1,
  omit_from_final_grade: false,
  created_by: 'user-1',
  created_at: '2026-09-01T00:00:00Z',
};

function stubAccess(role: 'admin' | 'teacher' | 'ta' | null = 'teacher') {
  const asked: { courseId: string; roles: readonly string[] }[] = [];
  return {
    asked,
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      asked.push({ courseId, roles });
      if (!role) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId, school_id: 'school-1' }, role };
    },
  };
}

function build(
  setup: (prisma: MockPrisma) => void = () => {},
  role: 'admin' | 'teacher' | 'ta' | null = 'teacher',
  auditLog?: { record: (...args: any[]) => Promise<void> },
) {
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue({ ...ACTIVITY });
  prisma.activity.create.mockImplementation(async ({ data }: any) => ({
    ...ACTIVITY,
    ...data,
  }));
  prisma.activity.update.mockImplementation(async ({ data }: any) => ({
    ...ACTIVITY,
    ...data,
  }));
  setup(prisma);
  const access = stubAccess(role);
  const service = new ActivityService(
    prisma as any,
    access as any,
    undefined,
    undefined,
    auditLog as any,
  );
  return { service, prisma, access };
}

describe('ActivityService.create', () => {
  test('records created activity fields in the write transaction', async () => {
    let args: any[] = [];
    const auditLog = {
      record: async (...recordArgs: any[]) => {
        args = recordArgs;
      },
    };
    const { service, prisma } = build(() => {}, 'teacher', auditLog);

    await service.create('user-1', 'course-1', {
      kind: 'assignment',
      title: 'Essay',
      points: 20,
      allowText: true,
    });

    expect(args[0]).toBe(prisma);
    expect(args[1]).toBe('school-1');
    expect(args[2]).toEqual({ id: 'user-1' });
    expect(args[3].entity).toBe('activity');
    expect(args[3].action).toBe('create');
    expect(args[3].changes.title).toEqual({ before: null, after: 'Essay' });
    expect(args[3].changes.points).toEqual({ before: null, after: 20 });
  });

  test('creates in the course and returns the Activity contract', async () => {
    const { service, prisma } = build();

    const result = await service.create('user-1', 'course-1', {
      kind: 'assignment',
      title: ' Essay ',
      points: 20,
      allowText: true,
    });

    const insert = prisma.activity.create.mock.calls[0][0].data;
    expect(insert.course_id).toBe('course-1');
    expect(insert.title).toBe('Essay');
    expect(insert).not.toHaveProperty('student_group_id');

    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'courseId',
        'assignmentGroupId',
        'kind',
        'title',
        'instructions',
        'points',
        'dueAt',
        'status',
        'publishedAt',
        'allowFile',
        'allowMultipleFiles',
        'allowText',
        'maxAttempts',
        'timeLimitMinutes',
        'lockdownBrowser',
        'shuffleQuestions',
        'shuffleOptions',
        'omitFromFinalGrade',
        'rubricId',
        'lateUntil',
        'latePenaltyMode',
        'latePenaltyValue',
        'latePenaltyCap',
        'createdAt',
      ].sort(),
    );
  });

  test('creates a quiz with a time limit and validates bounds', async () => {
    const { service, prisma } = build();
    await service.create('user-1', 'course-1', {
      kind: 'quiz',
      title: 'Timed Quiz',
      points: 10,
      timeLimitMinutes: 45,
    });
    expect(prisma.activity.create.mock.calls[0][0].data.time_limit_minutes).toBe(
      45,
    );

    await expect(
      service.create('user-1', 'course-1', {
        kind: 'assignment',
        title: 'Timed Assignment',
        points: 10,
        allowText: true,
        timeLimitMinutes: 30,
      }),
    ).rejects.toThrow('Only quizzes can have a time limit');

    await expect(
      service.create('user-1', 'course-1', {
        kind: 'quiz',
        title: 'Timed Quiz Invalid',
        points: 10,
        timeLimitMinutes: 0,
      }),
    ).rejects.toThrow('Time limit must be between 1 and 1440 minutes');
  });

  test('creates a quiz with lockdown browser and refuses for non-quizzes', async () => {
    const { service, prisma } = build();
    await service.create('user-1', 'course-1', {
      kind: 'quiz',
      title: 'Lockdown Quiz',
      points: 10,
      lockdownBrowser: true,
    });
    expect(prisma.activity.create.mock.calls[0][0].data.lockdown_browser).toBe(
      true,
    );

    await expect(
      service.create('user-1', 'course-1', {
        kind: 'assignment',
        title: 'Lockdown Assignment',
        points: 10,
        allowText: true,
        lockdownBrowser: true,
      }),
    ).rejects.toThrow('Only quizzes can require lockdown browser');
  });

  test('a TA cannot create work', async () => {
    const { service } = build(undefined, 'ta');
    await expect(
      service.create('user-1', 'course-1', {
        kind: 'quiz',
        title: 'Quiz',
        points: 10,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  test('refuses a group from another course', async () => {
    const { service } = build((p) =>
      p.assignment_group.findFirst.mockResolvedValue(null),
    );
    await expect(
      service.create('user-1', 'course-1', {
        kind: 'quiz',
        title: 'Quiz',
        points: 10,
        assignmentGroupId: 'group-x',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  test('accepts a group in the course', async () => {
    const { service, prisma } = build((p) =>
      p.assignment_group.findFirst.mockResolvedValue({ id: 'group-1' }),
    );
    await service.create('user-1', 'course-1', {
      kind: 'quiz',
      title: 'Quiz',
      points: 10,
      assignmentGroupId: 'group-1',
    });
    const lookup = prisma.assignment_group.findFirst.mock.calls[0][0];
    expect(lookup.where.course_id).toBe('course-1');
  });

  test('offline work accepts neither files nor text', async () => {
    const { service, prisma } = build();
    await service.create('user-1', 'course-1', {
      kind: 'offline',
      title: 'Practical',
      points: 50,
      allowFile: true,
      allowText: true,
    });
    const insert = prisma.activity.create.mock.calls[0][0].data;
    expect(insert.kind).toBe('offline');
    expect(insert.allow_file).toBe(false);
    expect(insert.allow_multiple_files).toBe(false);
    expect(insert.allow_text).toBe(false);
  });

  test('multiple files are opt-in and saved for file assignments', async () => {
    const { service, prisma } = build();
    const result = await service.create('user-1', 'course-1', {
      kind: 'assignment',
      title: 'Portfolio',
      points: 20,
      allowFile: true,
      allowText: false,
      allowMultipleFiles: true,
    });

    expect(
      prisma.activity.create.mock.calls[0][0].data.allow_multiple_files,
    ).toBe(true);
    expect(result.allowMultipleFiles).toBe(true);
  });

  test('multiple files cannot be enabled without file uploads', async () => {
    const { service } = build();
    await expect(
      service.create('user-1', 'course-1', {
        kind: 'assignment',
        title: 'Essay',
        points: 20,
        allowFile: false,
        allowText: true,
        allowMultipleFiles: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test('an assignment must accept something', async () => {
    const { service } = build();
    await expect(
      service.create('user-1', 'course-1', {
        kind: 'assignment',
        title: 'Essay',
        points: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ActivityService.update', () => {
  test('saves the multiple-file setting', async () => {
    const { service, prisma } = build();
    const result = await service.update('user-1', 'act-1', {
      allowMultipleFiles: true,
    });

    expect(
      prisma.activity.update.mock.calls[0][0].data.allow_multiple_files,
    ).toBe(true);
    expect(result.allowMultipleFiles).toBe(true);
  });

  test('cannot enable multiple files when file uploads are disabled', async () => {
    const { service } = build((p) =>
      p.activity.findUnique.mockResolvedValue({
        ...ACTIVITY,
        allow_file: false,
      }),
    );
    await expect(
      service.update('user-1', 'act-1', { allowMultipleFiles: true }),
    ).rejects.toThrow(BadRequestException);
  });

  test('disabling file uploads also disables multiple files', async () => {
    const { service, prisma } = build();
    await service.update('user-1', 'act-1', { allowFile: false });

    const update = prisma.activity.update.mock.calls[0][0].data;
    expect(update.allow_file).toBe(false);
    expect(update.allow_multiple_files).toBe(false);
  });

  test('moves to Ungrouped and omits from the final grade', async () => {
    const { service, prisma } = build();
    const result = await service.update('user-1', 'act-1', {
      assignmentGroupId: null,
      omitFromFinalGrade: true,
    });

    const update = prisma.activity.update.mock.calls[0][0].data;
    expect(update.assignment_group_id).toBeNull();
    expect(update.omit_from_final_grade).toBe(true);
    expect(result.omitFromFinalGrade).toBe(true);
  });

  test('refuses a group outside the course', async () => {
    const { service } = build((p) =>
      p.assignment_group.findFirst.mockResolvedValue(null),
    );
    await expect(
      service.update('user-1', 'act-1', { assignmentGroupId: 'group-x' }),
    ).rejects.toThrow(NotFoundException);
  });

  /** The activity row as the points change locks it. */
  const lockedAs = (kind: string, points: number) => (p: MockPrisma) =>
    p.$queryRaw.mockResolvedValue([{ kind, points }]);

  /** The SQL text of a tagged raw call. */
  const sql = (call: any[]) => (call[0] as string[]).join('?');

  test('refuses to lower points below a mark already given', async () => {
    const { service, prisma } = build((p) => {
      lockedAs('assignment', 20)(p);
      p.submission.findFirst.mockResolvedValue({ id: 'sub-1' });
    });
    await expect(
      service.update('user-1', 'act-1', { points: 10 }),
    ).rejects.toThrow(BadRequestException);
    const where = prisma.submission.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ activity_id: 'act-1', score: { gt: 10 } });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  test('lowers points when every mark still fits', async () => {
    const { service, prisma } = build((p) => {
      lockedAs('assignment', 20)(p);
      p.submission.findFirst.mockResolvedValue(null);
    });
    await service.update('user-1', 'act-1', { points: 15 });
    expect(prisma.activity.update.mock.calls[0][0].data.points).toBe(15);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  test('the mark check and the update share one transaction under a row lock', async () => {
    const order: string[] = [];
    const { service, prisma } = build((p) => {
      p.$queryRaw.mockImplementation(async (...call: any[]) => {
        order.push(sql(call).includes('for update') ? 'lock' : 'raw');
        return [{ kind: 'assignment', points: 20 }];
      });
      p.submission.findFirst.mockImplementation(async () => {
        order.push('check');
        return null;
      });
      p.activity.update.mockImplementation(async ({ data }: any) => {
        order.push('update');
        return { ...ACTIVITY, ...data };
      });
    });
    await service.update('user-1', 'act-1', { points: 30 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['lock', 'check', 'update']);
  });

  test("changing a quiz's points rescales its automatic scores only", async () => {
    const { service, prisma } = build((p) => {
      lockedAs('quiz', 10)(p);
      p.submission.findFirst.mockResolvedValue(null);
    });
    await service.update('user-1', 'act-1', { points: 20 });

    // Teacher marks are left alone, so only they must fit the new points.
    const where = prisma.submission.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      activity_id: 'act-1',
      score: { gt: 20 },
      graded_by: { not: null },
    });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const call = prisma.$executeRaw.mock.calls[0];
    expect(sql(call)).toContain('graded_by is null');
    expect(sql(call)).toContain('set score = score *');
    expect(call.slice(1)).toEqual([20, 10, 20, 10, 'act-1']);
    expect(prisma.activity.update.mock.calls[0][0].data.points).toBe(20);
  });

  test('a quiz going up from 0 points is rescored from its answers, not rescaled', async () => {
    const { service, prisma } = build((p) => {
      lockedAs('quiz', 0)(p);
      p.submission.findFirst.mockResolvedValue(null);
    });
    await service.update('user-1', 'act-1', { points: 25 });

    // Automatic scores are recomputed, so only teacher marks must fit.
    expect(prisma.submission.findFirst.mock.calls[0][0].where).toEqual({
      activity_id: 'act-1',
      score: { gt: 25 },
      graded_by: { not: null },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // One statement (a composed Prisma.Sql), from the stored answers.
    const query = prisma.$executeRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    const text = query.sql;
    // No division by the old (zero) points.
    expect(text).not.toContain('score = score *');
    expect(text).toContain('t.earned / t.possible');
    expect(text).toContain('lower(btrim(ans.text_answer)) = lower(btrim(o.label))');
    expect(text).toContain('s2.graded_by is null');
    expect(text).toContain('s2.quiz_started_at is null');
    expect(query.values).toEqual([25, 25, 'act-1', null, null]);
    // In the same transaction as the points themselves.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.activity.update.mock.calls[0][0].data.points).toBe(25);
  });

  test('a quiz at 0 points kept at 0 rescores nothing', async () => {
    const { service, prisma } = build((p) => {
      lockedAs('quiz', 0)(p);
      p.submission.findFirst.mockResolvedValue(null);
    });
    await service.update('user-1', 'act-1', { points: 0 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  test('a teacher mark above the new quiz points still refuses the change', async () => {
    const { service, prisma } = build((p) => {
      lockedAs('quiz', 20)(p);
      p.submission.findFirst.mockResolvedValue({ id: 'sub-1' });
    });
    await expect(
      service.update('user-1', 'act-1', { points: 10 }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  test('saving the same quiz points rescales nothing', async () => {
    const { service, prisma } = build(lockedAs('quiz', 10));
    await service.update('user-1', 'act-1', { points: 10 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  test('a change that leaves the points alone takes no lock', async () => {
    const { service, prisma } = build();
    await service.update('user-1', 'act-1', { title: 'New title' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.submission.findFirst).not.toHaveBeenCalled();
  });

  test('moving an untimed quiz due date moves running attempts without an extension', async () => {
    const { service, prisma } = build((p) => {
      const quiz = { ...ACTIVITY, kind: 'quiz', time_limit_minutes: null };
      p.activity.findUnique.mockResolvedValue(quiz);
      p.activity.update.mockImplementation(async ({ data }: any) => ({
        ...quiz,
        ...data,
      }));
    });
    await service.update('user-1', 'act-1', {
      dueAt: '2026-12-01T12:00:00.000Z',
    });
    const update = prisma.submission.updateMany.mock.calls[0][0];
    expect(update.where.activity_id).toBe('act-1');
    expect(update.where.student).toEqual({
      activity_extension: { none: { activity_id: 'act-1' } },
    });
    expect(update.data.quiz_expires_at).toEqual(
      new Date('2026-12-01T12:00:00.000Z'),
    );
  });

  test('changing a timed quiz due date leaves attempts alone', async () => {
    const { service, prisma } = build((p) => {
      const quiz = { ...ACTIVITY, kind: 'quiz', time_limit_minutes: 30 };
      p.activity.findUnique.mockResolvedValue(quiz);
      p.activity.update.mockImplementation(async ({ data }: any) => ({
        ...quiz,
        ...data,
      }));
    });
    await service.update('user-1', 'act-1', {
      dueAt: '2026-12-01T12:00:00.000Z',
    });
    expect(prisma.submission.updateMany).not.toHaveBeenCalled();
  });

  test('an activity with no course is not found', async () => {
    const { service } = build((p) =>
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, course_id: null }),
    );
    await expect(
      service.update('user-1', 'act-1', { title: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ActivityService.publish', () => {
  test('only sets the status; no assessment is created', async () => {
    const { service, prisma } = build();
    const result = await service.publish('user-1', 'act-1');

    expect(result.status).toBe('published');
    expect(result.publishedAt).toBeTruthy();
    expect(typeof result.publishedAt).toBe('string');
    expect(prisma.assessment.create).not.toHaveBeenCalled();
    expect(prisma.assessment.createMany).not.toHaveBeenCalled();
  });

  test('refuses work already published', async () => {
    const { service } = build((p) =>
      p.activity.findUnique.mockResolvedValue({
        ...ACTIVITY,
        status: 'published',
      }),
    );
    await expect(service.publish('user-1', 'act-1')).rejects.toThrow(
      ConflictException,
    );
  });

  test('a quiz needs a question first', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, kind: 'quiz' });
      p.quiz_question.count.mockResolvedValue(0);
    });
    await expect(service.publish('user-1', 'act-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ActivityService roles', () => {
  test('reading asks for any staff role', async () => {
    const { service, access } = build(undefined, 'ta');
    await service.get('user-1', 'act-1');
    expect(access.asked[0].roles).toContain('ta');
  });

  test('listing a course asks for any staff role', async () => {
    const { service, access } = build(
      (p) => p.activity.findMany.mockResolvedValue([ACTIVITY]),
      'ta',
    );
    const list = await service.listForCourse('user-1', 'course-1');
    expect(list).toHaveLength(1);
    expect(access.asked[0]).toEqual({
      courseId: 'course-1',
      roles: ['admin', 'teacher', 'ta'],
    });
  });

  test('a TA cannot delete', async () => {
    const { service } = build(undefined, 'ta');
    await expect(service.remove('user-1', 'act-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  test('someone outside the course gets a 404', async () => {
    const { service } = build(undefined, null);
    await expect(service.get('user-1', 'act-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
