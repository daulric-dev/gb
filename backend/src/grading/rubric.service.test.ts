import { describe, test, expect } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RubricService } from './rubric.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/**
 * Rubrics: building them, attaching one, and marking with it. The score a
 * rubric produces lands on the submission, which stays the one place a mark
 * lives; the criterion marks are written beside it in the same transaction.
 */

const RUBRIC_ROW = {
  id: 'rub-1',
  course_id: 'course-1',
  title: 'Essay rubric',
  created_by: 'user-1',
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  rubric_criterion: [
    {
      id: 'c1',
      rubric_id: 'rub-1',
      title: 'Argument',
      description: null,
      points: 6,
      position: 0,
      rubric_rating: [
        { id: 'r1', label: 'Strong', description: null, points: 6, position: 0 },
        { id: 'r2', label: 'Weak', description: null, points: 2, position: 1 },
      ],
    },
    {
      id: 'c2',
      rubric_id: 'rub-1',
      title: 'Spelling',
      description: 'Few errors',
      points: 4,
      position: 1,
      rubric_rating: [
        { id: 'r3', label: 'Clean', description: null, points: 4, position: 0 },
        { id: 'r4', label: 'Messy', description: null, points: 1, position: 1 },
      ],
    },
  ],
};

const ACTIVITY = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'assignment',
  points: 10,
  status: 'published',
  rubric_id: 'rub-1',
};

function stubAccess(role: 'teacher' | 'ta' | null = 'teacher') {
  return {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId }, role };
    },
  };
}

function build(
  setup: (prisma: MockPrisma) => void = () => {},
  role: 'teacher' | 'ta' | null = 'teacher',
) {
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue(ACTIVITY);
  prisma.rubric.findUnique.mockResolvedValue(RUBRIC_ROW);
  prisma.rubric.findFirst.mockResolvedValue(RUBRIC_ROW);
  prisma.course_student.findFirst.mockResolvedValue({ student_id: 'stu-1' });
  prisma.submission.upsert.mockImplementation(async ({ create }: any) => ({
    id: 'sub-1',
    student_id: 'stu-1',
    status: create.status,
    score: create.score,
    feedback: create.feedback,
    excused: false,
    excused_reason: null,
    graded_at: create.graded_at,
  }));
  setup(prisma);
  const service = new RubricService(prisma as any, stubAccess(role) as any);
  return { service, prisma };
}

describe('RubricService.create', () => {
  test('writes criteria and levels in order and returns the Rubric contract', async () => {
    const { service, prisma } = build();
    prisma.rubric.create.mockResolvedValue({ id: 'rub-1' });

    const result = await service.create('user-1', 'course-1', {
      title: '  Essay rubric ',
      criteria: [
        {
          title: 'Argument',
          points: 6,
          ratings: [
            { label: 'Strong', points: 6 },
            { label: 'Weak', points: 2 },
          ],
        },
      ],
    });

    expect(prisma.rubric.create.mock.calls[0][0].data).toEqual({
      course_id: 'course-1',
      title: 'Essay rubric',
      created_by: 'user-1',
    });
    const criterion = prisma.rubric_criterion.create.mock.calls[0][0].data;
    expect(criterion.position).toBe(0);
    expect(criterion.rubric_rating.create.map((r: any) => r.position)).toEqual([
      0, 1,
    ]);
    expect(result.pointsPossible).toBe(10);
    expect(result.criteria[1].ratings[0]).toEqual({
      id: 'r3',
      label: 'Clean',
      description: null,
      points: 4,
    });
  });

  test('a level worth more than its criterion is refused', async () => {
    const { service } = build();
    await expect(
      service.create('user-1', 'course-1', {
        title: 'R',
        criteria: [
          { title: 'A', points: 2, ratings: [{ label: 'Too much', points: 3 }] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('a TA cannot build rubrics', async () => {
    const { service } = build(undefined, 'ta');
    await expect(
      service.create('user-1', 'course-1', {
        title: 'R',
        criteria: [{ title: 'A', points: 1, ratings: [{ label: 'x', points: 1 }] }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('RubricService.update', () => {
  test('criteria are frozen once the rubric has marked someone', async () => {
    const { service } = build((p) => {
      p.rubric_criterion.findMany.mockResolvedValue([{ rubric_id: 'rub-1' }]);
    });
    await expect(
      service.update('user-1', 'course-1', 'rub-1', {
        criteria: [{ title: 'A', points: 1, ratings: [{ label: 'x', points: 1 }] }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('renaming an assessed rubric is fine', async () => {
    const { service, prisma } = build((p) => {
      p.rubric_criterion.findMany.mockResolvedValue([{ rubric_id: 'rub-1' }]);
    });
    const result = await service.update('user-1', 'course-1', 'rub-1', {
      title: 'Renamed',
    });
    expect(prisma.rubric.update.mock.calls[0][0].data.title).toBe('Renamed');
    expect(prisma.rubric_criterion.deleteMany).not.toHaveBeenCalled();
    expect(result.assessed).toBe(true);
  });
});

describe('RubricService.attach', () => {
  test('a quiz cannot take a rubric', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, kind: 'quiz' });
    });
    await expect(
      service.attach('user-1', 'act-1', 'rub-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('the rubric must belong to the activity course', async () => {
    const { service } = build((p) => {
      p.rubric.findFirst.mockResolvedValue(null);
    });
    await expect(
      service.attach('user-1', 'act-1', 'rub-other'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('detaching writes null', async () => {
    const { service, prisma } = build();
    await service.attach('user-1', 'act-1', null);
    expect(prisma.activity.update.mock.calls[0][0].data.rubric_id).toBeNull();
  });
});

describe('RubricService.assess', () => {
  test('the score is the sum of the picked levels', async () => {
    const { service, prisma } = build();
    const result = await service.assess('user-1', 'act-1', 'stu-1', {
      assessments: [
        { criterionId: 'c1', ratingId: 'r2', comment: ' thin ' },
        { criterionId: 'c2', ratingId: 'r3' },
      ],
      feedback: 'Good',
    });

    expect(result.submission.score).toBe(6);
    expect(result.rubricTotal).toBe(6);
    const upsert = prisma.submission.upsert.mock.calls[0][0];
    expect(upsert.update.score).toBe(6);
    expect(upsert.update.status).toBe('graded');
    expect(upsert.update.graded_by).toBe('user-1');

    // Old criterion marks replaced, new ones written with the submission.
    expect(prisma.rubric_assessment.deleteMany.mock.calls[0][0].where).toEqual({
      submission_id: 'sub-1',
      criterion_id: { in: ['c1', 'c2'] },
    });
    expect(prisma.rubric_assessment.createMany.mock.calls[0][0].data).toEqual([
      {
        criterion_id: 'c1',
        rating_id: 'r2',
        points: 2,
        comment: 'thin',
        submission_id: 'sub-1',
      },
      {
        criterion_id: 'c2',
        rating_id: 'r3',
        points: 4,
        comment: null,
        submission_id: 'sub-1',
      },
    ]);
  });

  test('bare points and a teacher override', async () => {
    const { service } = build();
    const result = await service.assess('user-1', 'act-1', 'stu-1', {
      assessments: [{ criterionId: 'c1', points: 5.5 }],
      score: 9,
    });
    expect(result.rubricTotal).toBe(5.5);
    expect(result.submission.score).toBe(9);
    expect(result.assessments[0].ratingId).toBeNull();
  });

  test('points above the criterion, unknown levels and repeats are refused', async () => {
    const { service } = build();
    for (const assessments of [
      [{ criterionId: 'c2', points: 5 }],
      [{ criterionId: 'c1', ratingId: 'r3' }],
      [{ criterionId: 'nope', ratingId: 'r1' }],
      [{ criterionId: 'c1' }],
      [
        { criterionId: 'c1', ratingId: 'r1' },
        { criterionId: 'c1', ratingId: 'r2' },
      ],
    ]) {
      await expect(
        service.assess('user-1', 'act-1', 'stu-1', { assessments }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  test('a rubric worth more than the activity needs an override', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, points: 8 });
    });
    await expect(
      service.assess('user-1', 'act-1', 'stu-1', {
        assessments: [
          { criterionId: 'c1', ratingId: 'r1' },
          { criterionId: 'c2', ratingId: 'r3' },
        ],
      }),
    ).rejects.toThrow('Give a score to override it');
  });

  test('drafts, missing rubrics and students off the roster are refused', async () => {
    const draft = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, status: 'draft' });
    });
    await expect(
      draft.service.assess('user-1', 'act-1', 'stu-1', { assessments: [] }),
    ).rejects.toBeInstanceOf(ConflictException);

    const bare = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, rubric_id: null });
    });
    await expect(
      bare.service.assess('user-1', 'act-1', 'stu-1', { assessments: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const stranger = build((p) => {
      p.course_student.findFirst.mockResolvedValue(null);
    });
    await expect(
      stranger.service.assess('user-1', 'act-1', 'stu-1', { assessments: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a TA may mark with a rubric', async () => {
    const { service } = build(undefined, 'ta');
    const result = await service.assess('user-1', 'act-1', 'stu-1', {
      assessments: [{ criterionId: 'c1', ratingId: 'r1' }],
    });
    expect(result.submission.score).toBe(6);
  });
});

describe('RubricService.forActivity', () => {
  test('returns the rubric and marks keyed by student', async () => {
    const { service } = build((p) => {
      p.submission.findMany.mockResolvedValue([
        { id: 'sub-1', student_id: 'stu-1' },
        { id: 'sub-2', student_id: 'stu-2' },
      ]);
      p.rubric_assessment.findMany.mockResolvedValue([
        {
          submission_id: 'sub-1',
          criterion_id: 'c1',
          rating_id: 'r1',
          points: '6',
          comment: null,
        },
      ]);
    });
    const result = await service.forActivity('user-1', 'act-1');
    expect(result.rubric?.id).toBe('rub-1');
    expect(result.assessments).toEqual({
      'stu-1': [{ criterionId: 'c1', ratingId: 'r1', points: 6, comment: null }],
    });
  });
});
