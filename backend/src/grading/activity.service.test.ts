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
  const service = new ActivityService(prisma as any, access as any);
  return { service, prisma, access };
}

describe('ActivityService.create', () => {
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
        'allowText',
        'maxAttempts',
        'omitFromFinalGrade',
        'rubricId',
        'createdAt',
      ].sort(),
    );
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
    expect(insert.allow_text).toBe(false);
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
