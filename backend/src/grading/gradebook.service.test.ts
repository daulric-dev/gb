import { describe, test, expect } from 'bun:test';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GradebookService } from './gradebook.service';
import { AssignmentGroupService } from './assignment-group.service';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/**
 * The gradebook wiring: what it reads, the contract it returns, the letter
 * fallback and the CSV. The arithmetic itself is pinned in
 * gradebook.calc.test.ts.
 */

const COURSE = {
  id: 'course-1',
  school_id: 'school-1',
  name: 'Biology - 5A',
  code: 'BIO=5A',
  grade_scale_id: null,
};

function activity(id: string, over: Record<string, any> = {}) {
  return {
    id,
    course_id: 'course-1',
    assignment_group_id: 'hw',
    kind: 'assignment',
    title: `Work ${id}`,
    instructions: null,
    points: 10,
    due_at: null,
    status: 'published',
    published_at: new Date('2026-09-01T00:00:00Z'),
    allow_file: true,
    allow_text: false,
    max_attempts: 1,
    omit_from_final_grade: false,
    created_by: 'user-1',
    created_at: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

function stubAccess(role: 'teacher' | 'ta' | null = 'ta') {
  return {
    require: async (_u: string, _c: string, roles: readonly string[]) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: COURSE, role };
    },
    requireStudent: async () => COURSE,
  };
}

const dec = (n: number) => new Prisma.Decimal(n);

function build(
  setup: (prisma: MockPrisma) => void,
  role: 'teacher' | 'ta' | null = 'ta',
) {
  const prisma = createMockPrisma();
  prisma.course.findUnique.mockResolvedValue(COURSE);
  prisma.assignment_group.findMany.mockResolvedValue([
    {
      id: 'hw',
      course_id: 'course-1',
      name: 'Homework',
      weight: null,
      position: 0,
    },
  ]);
  prisma.grade_scale.findFirst.mockResolvedValue({ id: 'scale-1' });
  prisma.grade_scale_band.findMany.mockResolvedValue([
    { label: 'A', min_percentage: dec(80), max_percentage: dec(100) },
    { label: 'B', min_percentage: dec(0), max_percentage: dec(79) },
  ]);
  setup(prisma);
  const access = stubAccess(role);
  const groups = new AssignmentGroupService(prisma as any, access as any);
  const service = new GradebookService(prisma as any, access as any, groups);
  return { service, prisma };
}

/** The usual course: two activities, two students, three submissions. */
function TABLES(
  over: { activities?: any[]; submissions?: any[] } = {},
): (prisma: MockPrisma) => void {
  return (p) => {
    p.activity.findMany.mockResolvedValue(
      over.activities ?? [
        activity('a1'),
        activity('a2', { title: '=HYPERLINK("x")' }),
      ],
    );
    p.course_student.findMany.mockResolvedValue([
      { student_id: 'stu-2', status: 'active' },
      { student_id: 'stu-1', status: 'completed' },
    ]);
    p.student.findMany.mockResolvedValue([
      { id: 'stu-1', first_name: 'Ann', last_name: 'Adams' },
      { id: 'stu-2', first_name: 'Bo', last_name: 'Brown' },
    ]);
    p.submission.findMany.mockResolvedValue(
      over.submissions ?? [
        {
          activity_id: 'a1',
          student_id: 'stu-1',
          status: 'graded',
          score: dec(9),
          excused: false,
          submitted_at: null,
        },
        {
          activity_id: 'a2',
          student_id: 'stu-1',
          status: 'graded',
          score: dec(0),
          excused: true,
          submitted_at: null,
        },
        {
          activity_id: 'a1',
          student_id: 'stu-2',
          status: 'submitted',
          score: null,
          excused: false,
          submitted_at: new Date('2026-09-02T00:00:00Z'),
        },
      ],
    );
  };
}

describe('GradebookService.gradebook', () => {
  test('returns the Gradebook contract with per-student totals', async () => {
    const { service } = build(TABLES());
    const book = await service.gradebook('user-1', 'course-1');

    expect(book.groups).toEqual([
      {
        id: 'hw',
        courseId: 'course-1',
        name: 'Homework',
        weight: null,
        position: 0,
      },
    ]);
    expect(book.activities.map((a) => a.id)).toEqual(['a1', 'a2']);
    // Sorted by last name.
    expect(book.students.map((s) => s.studentId)).toEqual(['stu-1', 'stu-2']);

    const ann = book.students[0];
    expect(ann.status).toBe('completed');
    expect(ann.cells.a2).toEqual({
      score: 0,
      status: 'graded',
      excused: true,
      submittedAt: null,
    });
    // a2 excused: 9/10.
    expect(ann.grade.percent).toBe(90);
    expect(ann.grade.letter).toBe('A');

    const bo = book.students[1];
    expect(bo.cells.a1.status).toBe('submitted');
    expect(bo.cells.a1.submittedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(book.activities[0].points).toBe(10);
    expect(book.activities[0].createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(bo.cells.a2).toBeUndefined();
    expect(bo.grade.percent).toBeNull();
    expect(bo.grade.letter).toBeNull();
  });

  test('uses the course scale before the school default', async () => {
    const { service, prisma } = build(TABLES());
    (COURSE as any).grade_scale_id = 'course-scale';
    try {
      await service.gradebook('user-1', 'course-1');
    } finally {
      (COURSE as any).grade_scale_id = null;
    }
    const band = prisma.grade_scale_band.findMany.mock.calls[0][0];
    expect(band.where.grade_scale_id).toBe('course-scale');
    expect(prisma.grade_scale.findFirst).not.toHaveBeenCalled();
  });

  test('someone outside the course gets a 404', async () => {
    const { service } = build(TABLES(), null);
    await expect(service.gradebook('user-1', 'course-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('GradebookService.exportCsv', () => {
  test('one row per student, EX for excused, formulas defused', async () => {
    const { service } = build(TABLES());
    const { csv, filename } = await service.exportCsv('user-1', 'course-1');

    expect(filename).toBe('BIO-5A-grades.csv');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(
      `Last name,First name,Status,Work a1 (10),"'=HYPERLINK(""x"") (10)",Homework %,Total %,Letter`,
    );
    expect(lines[1]).toBe('Adams,Ann,completed,9,EX,90,90,A');
    expect(lines[2]).toBe('Brown,Bo,active,,,,,');
  });
});

describe('GradebookService.studentSummary', () => {
  test('computes one student without a staff check', async () => {
    const { service } = build(
      TABLES({
        submissions: [
          {
            activity_id: 'a1',
            student_id: 'stu-1',
            status: 'graded',
            score: dec(5),
            excused: false,
          },
        ],
      }),
      null,
    );
    const grade = await service.studentSummary('course-1', 'stu-1');
    expect(grade.percent).toBe(50);
    expect(grade.letter).toBe('B');
    expect(grade.groups[0].groupId).toBe('hw');
  });
});

describe('GradebookService.studentGrades', () => {
  test('lists activities with group names and only graded feedback', async () => {
    const { service } = build(
      TABLES({
        activities: [
          activity('a1'),
          activity('a2', { assignment_group_id: null }),
        ],
        submissions: [
          {
            activity_id: 'a1',
            student_id: 'stu-1',
            status: 'graded',
            score: dec(8),
            excused: false,
            feedback: 'Nice',
            attempt_count: 0,
          },
          {
            activity_id: 'a2',
            student_id: 'stu-1',
            status: 'submitted',
            score: null,
            excused: false,
            feedback: 'draft note',
            attempt_count: 0,
          },
        ],
      }),
    );

    const page = await service.studentGrades('stu-1', 'course-1');
    expect(page.grade.percent).toBe(80);
    expect(page.activities[0].groupName).toBe('Homework');
    expect(page.activities[0].submission!.feedback).toBe('Nice');
    expect(page.activities[0].submission!.score).toBe(8);
    expect(page.activities[1].groupName).toBeNull();
    expect(page.activities[1].submission!.feedback).toBeNull();
    expect(page.activities[0]).not.toHaveProperty('omitFromFinalGrade');
  });
});

describe('AssignmentGroupService', () => {
  test('a duplicate name is a conflict', async () => {
    const { prisma } = build((p) =>
      p.assignment_group.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    );
    const groups = new AssignmentGroupService(
      prisma as any,
      stubAccess('teacher') as any,
    );
    await expect(
      groups.create('user-1', 'course-1', { name: 'Homework' }),
    ).rejects.toThrow(ConflictException);
  });

  test('a TA cannot change groups', async () => {
    const { prisma } = build(() => {});
    const groups = new AssignmentGroupService(
      prisma as any,
      stubAccess('ta') as any,
    );
    await expect(
      groups.create('user-1', 'course-1', { name: 'Labs' }),
    ).rejects.toThrow(ForbiddenException);
  });

  test('reorder refuses ids from another course', async () => {
    const { prisma } = build(() => {});
    const groups = new AssignmentGroupService(
      prisma as any,
      stubAccess('teacher') as any,
    );
    await expect(
      groups.reorder('user-1', 'course-1', ['other']),
    ).rejects.toThrow(NotFoundException);
  });

  test('reorder writes positions in the order sent', async () => {
    const { prisma } = build((p) =>
      p.assignment_group.findMany.mockResolvedValue([
        {
          id: 'g1',
          course_id: 'course-1',
          name: 'A',
          weight: dec(50),
          position: 0,
        },
        {
          id: 'g2',
          course_id: 'course-1',
          name: 'B',
          weight: dec(50),
          position: 1,
        },
      ]),
    );
    const groups = new AssignmentGroupService(
      prisma as any,
      stubAccess('teacher') as any,
    );
    const result = await groups.reorder('user-1', 'course-1', ['g2']);
    expect(result[0].weight).toBe(50);

    const updates = prisma.assignment_group.updateMany.mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(updates.every((u: any) => u.where.course_id === 'course-1')).toBe(
      true,
    );
    expect(updates.map((u: any) => [u.where.id, u.data.position])).toEqual([
      ['g2', 0],
      ['g1', 1],
    ]);
  });
});
