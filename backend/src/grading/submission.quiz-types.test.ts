import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { SubmissionService } from './submission.service';
import { QuestionBankService } from './question-bank.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

/**
 * The newer quiz question kinds end to end through the service: attempts
 * drawn and stored at start (stable on resume), what the student is sent,
 * "needs marking" until essay and file questions are marked, and banks.
 */

const FUTURE = new Date(Date.now() + 86_400_000);
const QUIZ = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'quiz',
  title: 'Quiz',
  instructions: null,
  points: 10,
  due_at: FUTURE,
  late_until: null,
  status: 'published',
  allow_file: false,
  allow_multiple_files: false,
  allow_text: false,
  max_attempts: null,
  time_limit_minutes: null,
  lockdown_browser: false,
  shuffle_questions: true,
  shuffle_options: true,
  rubric_id: null,
};

function access(role: 'teacher' | 'ta' = 'teacher') {
  return {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId, school_id: 'school-1' }, role };
    },
    requireStudent: async (_s: string, courseId: string) => ({ id: courseId, school_id: 'school-1' }),
  };
}

function build(setup: (p: MockPrisma) => void, role: 'teacher' | 'ta' = 'teacher') {
  const prisma = createMockPrisma();
  setup(prisma);
  const service = new SubmissionService(prisma as any, {} as any, access(role) as any);
  return { service, prisma };
}

describe('starting an attempt', () => {
  function tables(locked: Record<string, unknown>) {
    return (p: MockPrisma) => {
      p.activity.findUnique.mockResolvedValue(QUIZ);
      p.submission.findFirst.mockResolvedValue({ id: 'sub-1', status: 'draft', file_id: null });
      p.$queryRaw.mockResolvedValue([locked]);
      p.quiz_question.findMany.mockImplementation(async ({ where }: any) =>
        where.activity_id
          ? [
              { id: 'q1', kind: 'multiple_choice' },
              { id: 'q2', kind: 'ordering' },
            ]
          : [
              { id: 'b1', kind: 'numeric', bank_id: 'bank-1' },
              { id: 'b2', kind: 'essay', bank_id: 'bank-1' },
              { id: 'b3', kind: 'numeric', bank_id: 'bank-1' },
            ],
      );
      p.quiz_bank_draw.findMany.mockResolvedValue([{ bank_id: 'bank-1', draw_count: 2 }]);
      p.quiz_option.findMany.mockResolvedValue([
        { id: 'a', question_id: 'q1' },
        { id: 'b', question_id: 'q1' },
        { id: 'o1', question_id: 'q2' },
        { id: 'o2', question_id: 'q2' },
      ]);
    };
  }

  test('a new attempt stores its own questions: the quiz’s plus N drawn from the bank', async () => {
    const { service, prisma } = build(
      tables({ attempt_count: 0, graded_by: null, quiz_started_at: null, quiz_expires_at: null }),
    );
    await service.startQuizAttempt('stu-1', 'act-1');
    expect(prisma.quiz_attempt_question.deleteMany).toHaveBeenCalledWith({
      where: { submission_id: 'sub-1' },
    });
    const rows = prisma.quiz_attempt_question.createMany.mock.calls[0][0].data as any[];
    expect(rows).toHaveLength(4);
    const ids = rows.map((r) => r.question_id);
    expect(ids).toContain('q1');
    expect(ids).toContain('q2');
    expect(ids.filter((id: string) => id.startsWith('b'))).toHaveLength(2);
    // Ordering items never in their right order.
    expect(rows.find((r) => r.question_id === 'q2').option_order).toEqual(['o2', 'o1']);
    // Answers from the last attempt go, bank questions' included.
    expect(prisma.quiz_answer.deleteMany).toHaveBeenCalledWith({ where: { submission_id: 'sub-1' } });
  });

  test('resuming a running attempt keeps its questions (no new draw)', async () => {
    const { service, prisma } = build(
      tables({
        attempt_count: 0,
        graded_by: null,
        quiz_started_at: new Date(),
        quiz_expires_at: FUTURE,
      }),
    );
    await service.startQuizAttempt('stu-1', 'act-1');
    expect(prisma.quiz_attempt_question.createMany).not.toHaveBeenCalled();
    expect(prisma.quiz_attempt_question.deleteMany).not.toHaveBeenCalled();
  });
});

describe('what the student is sent during an attempt', () => {
  test('the attempt’s questions in its order, options in its order, never the key', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue(QUIZ);
      p.submission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: 'draft',
        quiz_started_at: new Date(),
        quiz_expires_at: FUTURE,
        attempt_count: 0,
        file_id: null,
      });
      p.quiz_attempt_question.findMany.mockResolvedValue([
        { question_id: 'b1', position: 0, option_order: [] },
        { question_id: 'q1', position: 1, option_order: ['b', 'a'] },
      ]);
      p.quiz_question.findMany.mockResolvedValue([
        { id: 'q1', prompt: 'Pick', kind: 'multiple_choice', points: new Prisma.Decimal(1), sort_order: 0 },
        { id: 'b1', prompt: 'How much?', kind: 'numeric', points: new Prisma.Decimal(2), sort_order: 0 },
      ]);
      p.quiz_option.findMany.mockResolvedValue([
        { id: 'a', question_id: 'q1', label: 'A', match_label: null, sort_order: 0 },
        { id: 'b', question_id: 'q1', label: 'B', match_label: null, sort_order: 1 },
      ]);
    });
    const work = await service.getForStudent('stu-1', 'act-1');
    expect(work.questions.map((q: any) => q.id)).toEqual(['b1', 'q1']);
    expect(work.questions[1].options).toEqual([
      { id: 'b', label: 'B' },
      { id: 'a', label: 'A' },
    ]);
    expect(work.questionCount).toBe(2);
    const json = JSON.stringify(work.questions);
    expect(json).not.toContain('isCorrect');
    expect(json).not.toContain('numericAnswer');
  });
});

describe('needs marking', () => {
  test('a quiz with an unmarked essay answers with no score yet', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue(QUIZ);
      p.submission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: 'draft',
        file_id: null,
        graded_by: null,
        quiz_started_at: new Date(),
      });
      p.$queryRaw
        .mockResolvedValueOnce([
          { attempt_count: 0, graded_by: null, quiz_started_at: new Date(), quiz_expires_at: FUTURE, expired: false },
        ])
        .mockResolvedValueOnce([{ score: new Prisma.Decimal(5), points: new Prisma.Decimal(10), attempts_used: 1 }]);
      p.submission.findUnique.mockResolvedValue({ score: new Prisma.Decimal(5), status: 'submitted' });
    });
    expect(await service.submitQuiz('stu-1', 'act-1', [])).toEqual({
      score: null,
      points: 10,
      needsMarking: true,
    });
  });

  function marking(question: Record<string, unknown> | null, submission?: Record<string, unknown>) {
    return (p: MockPrisma) => {
      p.activity.findUnique.mockResolvedValue({ ...QUIZ, school_id: 'school-1' });
      p.submission.findFirst.mockResolvedValue(
        submission ?? { id: 'sub-1', status: 'submitted', quiz_started_at: null, graded_by: null },
      );
      p.quiz_question.findFirst.mockResolvedValue(question);
      p.$queryRaw.mockResolvedValue([{ points: new Prisma.Decimal(10) }]);
      p.submission.findUnique.mockResolvedValue({
        id: 'sub-1',
        student_id: 'stu-1',
        status: 'graded',
        score: new Prisma.Decimal(8),
        raw_score: new Prisma.Decimal(8),
        feedback: null,
        excused: false,
        excused_reason: null,
        graded_at: new Date(),
        late_seconds: 0,
        late_penalty_percent: 0,
        late_penalty_waived: false,
      });
    };
  }

  test('marking the essay rescores the quiz from its answers and it becomes graded', async () => {
    const { service, prisma } = build(marking({ id: 'q-essay', kind: 'essay', points: new Prisma.Decimal(4) }), 'ta');
    const marked = await service.markQuestion('ta-1', 'act-1', 'stu-1', 'q-essay', { points: 3, feedback: 'Good' });
    expect(prisma.quiz_answer.upsert.mock.calls[0][0].update).toMatchObject({
      manual_points: 3,
      manual_feedback: 'Good',
      marked_by: 'ta-1',
    });
    const sql = prisma.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toEqual([10, 10, 'act-1', 'sub-1', 'sub-1']);
    expect(marked.status).toBe('graded');
    expect(marked.score).toBe(8);
  });

  test('only essay and file questions are marked by hand, within their points', async () => {
    const auto = build(marking({ id: 'q1', kind: 'numeric', points: new Prisma.Decimal(4) }));
    await expect(auto.service.markQuestion('t', 'act-1', 'stu-1', 'q1', { points: 1 })).rejects.toThrow(
      BadRequestException,
    );
    const over = build(marking({ id: 'q-essay', kind: 'essay', points: new Prisma.Decimal(4) }));
    await expect(over.service.markQuestion('t', 'act-1', 'stu-1', 'q-essay', { points: 5 })).rejects.toThrow(
      'Points must be between 0 and 4',
    );
    const missing = build(marking(null));
    await expect(missing.service.markQuestion('t', 'act-1', 'stu-1', 'q-x', { points: 1 })).rejects.toThrow(
      NotFoundException,
    );
  });

  test('not while the student is still taking it', async () => {
    const { service } = build(
      marking(
        { id: 'q-essay', kind: 'essay', points: new Prisma.Decimal(4) },
        { id: 'sub-1', status: 'draft', quiz_started_at: new Date(), graded_by: null },
      ),
    );
    await expect(service.markQuestion('t', 'act-1', 'stu-1', 'q-essay', { points: 1 })).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('question banks', () => {
  function banks(role: 'teacher' | 'ta', setup: (p: MockPrisma) => void = () => {}) {
    const prisma = createMockPrisma();
    prisma.question_bank.findUnique.mockResolvedValue({
      id: 'bank-1',
      course_id: 'course-1',
      title: 'Fractions',
      created_at: new Date(),
      updated_at: new Date(),
    });
    setup(prisma);
    return { service: new QuestionBankService(prisma as any, access(role) as any), prisma };
  }

  test('a TA reads banks but cannot build them', async () => {
    const { service } = banks('ta');
    await expect(service.create('ta-1', 'course-1', { title: 'New' })).rejects.toThrow(ForbiddenException);
    await expect(service.get('ta-1', 'bank-1')).resolves.toMatchObject({ id: 'bank-1' });
  });

  test('a question students have been given is frozen', async () => {
    const { service } = banks('teacher', (p) => {
      p.quiz_question.findFirst.mockResolvedValue({ id: 'q1', kind: 'numeric', prompt: 'p', points: 1 });
      p.quiz_attempt_question.findMany.mockResolvedValue([{ question_id: 'q1' }]);
    });
    await expect(service.updateQuestion('t', 'bank-1', 'q1', { prompt: 'new' })).rejects.toThrow(ConflictException);
    await expect(service.removeQuestion('t', 'bank-1', 'q1')).rejects.toThrow(ConflictException);
  });

  test('a bank used by attempts is kept', async () => {
    const { service } = banks('teacher', (p) => {
      p.quiz_attempt_question.count.mockResolvedValue(3);
    });
    await expect(service.remove('t', 'bank-1')).rejects.toThrow(ConflictException);
  });

  test('a draft quiz draws at most what a course bank holds', async () => {
    const { service, prisma } = banks('teacher', (p) => {
      p.activity.findUnique.mockResolvedValue({ id: 'act-1', course_id: 'course-1', kind: 'quiz', status: 'draft' });
      p.question_bank.findMany.mockResolvedValue([
        { id: 'bank-1', title: 'Fractions', _count: { quiz_question: 4 } },
      ]);
    });
    await expect(service.setDraws('t', 'act-1', [{ bankId: 'bank-1', count: 5 }])).rejects.toThrow(
      '"Fractions" has only 4 questions',
    );
    await expect(service.setDraws('t', 'act-1', [{ bankId: 'bank-2', count: 1 }])).rejects.toThrow(
      NotFoundException,
    );
    await service.setDraws('t', 'act-1', [{ bankId: 'bank-1', count: 3 }]);
    expect(prisma.quiz_bank_draw.createMany.mock.calls[0][0].data).toEqual([
      { activity_id: 'act-1', bank_id: 'bank-1', draw_count: 3, sort_order: 0 },
    ]);
  });

  test('a published quiz’s draws cannot change', async () => {
    const { service } = banks('teacher', (p) => {
      p.activity.findUnique.mockResolvedValue({ id: 'act-1', course_id: 'course-1', kind: 'quiz', status: 'published' });
    });
    await expect(service.setDraws('t', 'act-1', [])).rejects.toThrow(ConflictException);
  });
});
