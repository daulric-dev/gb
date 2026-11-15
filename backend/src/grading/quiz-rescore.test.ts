import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { rescoreQuizFromAnswers, scoreQuizSubmission } from './quiz-rescore';

function scoringTables() {
  const prisma = createMockPrisma();
  prisma.submission.findUnique.mockResolvedValue({
    id: 'sub-1',
    activity_id: 'act-1',
    attempt_count: 1,
    quiz_started_at: null,
    activity: { points: 20 },
  });
  prisma.quiz_attempt_question.findMany.mockResolvedValue([{ question_id: 'q-1' }]);
  prisma.quiz_question.findMany.mockResolvedValue([
    {
      id: 'q-1',
      kind: 'multiple_select',
      points: 10,
      numeric_answer: null,
      numeric_tolerance: 0,
      partial_credit: true,
    },
  ]);
  prisma.quiz_option.findMany.mockResolvedValue([
    { id: 'o-1', question_id: 'q-1', label: 'A', is_correct: true, match_label: null },
    { id: 'o-2', question_id: 'q-1', label: 'B', is_correct: true, match_label: null },
    { id: 'o-3', question_id: 'q-1', label: 'C', is_correct: false, match_label: null },
  ]);
  prisma.quiz_answer.findMany.mockResolvedValue([
    {
      question_id: 'q-1',
      option_id: null,
      option_ids: ['o-1'],
      matches: null,
      text_answer: null,
      numeric_answer: null,
      file_id: null,
      manual_points: null,
    },
  ]);
  return prisma;
}

describe('portable quiz scoring', () => {
  test('scores using the attempt question set and persists the full result', async () => {
    const prisma = scoringTables();
    const startedAt = new Date('2026-11-01T10:00:00Z');
    const result = await scoreQuizSubmission(prisma as never, 'sub-1', undefined, {
      startedAt,
      attemptsUsed: 1,
    });
    expect(result).toEqual({ score: 10, points: 20, attempts_used: 1, status: 'graded' });
    expect(prisma.quiz_question.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['q-1'] },
    });
    expect(prisma.submission.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'sub-1' },
      data: {
        status: 'graded',
        score: 10,
        raw_score: 10,
        attempt_count: 1,
        attempt_started_at: startedAt,
        quiz_started_at: null,
        quiz_expires_at: null,
      },
    });
  });

  test('keeps an answered unmarked essay submitted with no graded timestamp', async () => {
    const prisma = scoringTables();
    prisma.quiz_question.findMany.mockResolvedValue([
      {
        id: 'q-essay',
        kind: 'essay',
        points: 10,
        numeric_answer: null,
        numeric_tolerance: 0,
        partial_credit: false,
      },
    ]);
    prisma.quiz_option.findMany.mockResolvedValue([]);
    prisma.quiz_answer.findMany.mockResolvedValue([
      {
        question_id: 'q-essay',
        option_id: null,
        option_ids: [],
        matches: null,
        text_answer: 'An answer',
        numeric_answer: null,
        file_id: null,
        manual_points: null,
      },
    ]);
    const result = await scoreQuizSubmission(prisma as never, 'sub-1');
    expect(result?.status).toBe('submitted');
    expect(prisma.submission.update.mock.calls[0][0].data).toMatchObject({
      status: 'submitted',
      score: 0,
      graded_at: null,
    });
  });

  test('uses the quiz question set when a legacy attempt has no snapshot', async () => {
    const prisma = scoringTables();
    prisma.quiz_attempt_question.findMany.mockResolvedValue([]);
    await scoreQuizSubmission(prisma as never, 'sub-1');
    expect(prisma.quiz_question.findMany.mock.calls[0][0].where).toEqual({
      activity_id: 'act-1',
    });
  });

  test('rescoring only selects completed automatic submissions', async () => {
    const prisma = scoringTables();
    prisma.submission.findMany.mockResolvedValue([{ id: 'sub-1' }]);
    expect(await rescoreQuizFromAnswers(prisma as never, 'act-1', 50)).toBe(1);
    expect(prisma.submission.findMany.mock.calls[0][0].where).toEqual({
      activity_id: 'act-1',
      graded_by: null,
      score: { not: null },
      quiz_started_at: null,
    });
    expect(prisma.submission.update.mock.calls[0][0].data.score).toBe(25);
    expect(prisma.submission.update.mock.calls[0][0].data).not.toHaveProperty('submitted_at');
    expect(prisma.submission.update.mock.calls[0][0].data).not.toHaveProperty('attempt_count');
  });
});
