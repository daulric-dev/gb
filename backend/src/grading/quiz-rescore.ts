import type { Prisma } from '@/generated/prisma/client';
import { questionCredit, stringList } from './quiz-questions';

export type ScoredQuiz = {
  score: number;
  points: number;
  attempts_used: number;
  status: 'submitted' | 'graded';
};

/** Score a saved attempt with the same TypeScript rules used in quiz views. */
export async function scoreQuizSubmission(
  tx: Prisma.TransactionClient,
  submissionId: string,
  pointsOverride?: number,
  submittedAttempt?: { startedAt: Date; attemptsUsed: number },
): Promise<ScoredQuiz | null> {
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      activity_id: true,
      attempt_count: true,
      quiz_started_at: true,
      graded_at: true,
      activity: { select: { points: true } },
    },
  });
  if (!submission) return null;

  const attempt = await tx.quiz_attempt_question.findMany({
    where: { submission_id: submissionId },
    select: { question_id: true },
  });
  const questions = await tx.quiz_question.findMany({
    where: attempt.length
      ? { id: { in: attempt.map((row) => row.question_id) } }
      : { activity_id: submission.activity_id },
    select: {
      id: true,
      kind: true,
      points: true,
      numeric_answer: true,
      numeric_tolerance: true,
      partial_credit: true,
    },
  });
  const questionIds = questions.map((question) => question.id);
  const [options, answers] = questionIds.length
    ? await Promise.all([
        tx.quiz_option.findMany({
          where: { question_id: { in: questionIds } },
          select: { id: true, question_id: true, label: true, is_correct: true, match_label: true },
          orderBy: { sort_order: 'asc' },
        }),
        tx.quiz_answer.findMany({
          where: { submission_id: submissionId, question_id: { in: questionIds } },
          select: {
            question_id: true,
            option_id: true,
            option_ids: true,
            matches: true,
            text_answer: true,
            numeric_answer: true,
            file_id: true,
            manual_points: true,
          },
        }),
      ])
    : [[], []];

  const answerByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  let possible = 0;
  let earned = 0;
  let unmarked = false;
  for (const question of questions) {
    const points = Number(question.points);
    possible += points;
    const answer = answerByQuestion.get(question.id);
    const matches = answer?.matches;
    const result = questionCredit(
      {
        kind: question.kind,
        points,
        numericAnswer: question.numeric_answer === null ? null : Number(question.numeric_answer),
        numericTolerance: Number(question.numeric_tolerance ?? 0),
        partialCredit: question.partial_credit,
        options: options
          .filter((option) => option.question_id === question.id)
          .map((option) => ({
            id: option.id,
            label: option.label,
            isCorrect: option.is_correct,
            matchLabel: option.match_label,
          })),
      },
      answer
        ? {
            optionId: answer.option_id,
            optionIds: stringList(answer.option_ids),
            matches:
              matches && typeof matches === 'object'
                ? (matches as Record<string, string>)
                : null,
            text: answer.text_answer,
            numeric: answer.numeric_answer === null ? null : Number(answer.numeric_answer),
            fileId: answer.file_id,
            manualPoints: answer.manual_points === null ? null : Number(answer.manual_points),
          }
        : null,
    );
    earned += points * result.credit;
    unmarked ||= result.needsMarking;
  }

  const points = pointsOverride ?? Number(submission.activity.points);
  const score = possible > 0 ? (earned / possible) * points : 0;
  const status = unmarked ? 'submitted' : 'graded';
  const attemptsUsed = submittedAttempt?.attemptsUsed ?? submission.attempt_count;
  const now = new Date();
  const data: Prisma.submissionUpdateInput = {
    status,
    graded_at: unmarked ? null : submittedAttempt ? now : submission.graded_at ?? now,
    score,
    raw_score: score,
    updated_at: now,
  };
  if (submittedAttempt) {
    Object.assign(data, {
      submitted_at: now,
      attempt_started_at: submittedAttempt.startedAt,
      attempt_count: submittedAttempt.attemptsUsed,
      quiz_started_at: null,
      quiz_expires_at: null,
      is_away: false,
    });
  }
  await tx.submission.update({
    where: { id: submissionId },
    data,
  });
  return { score, points, attempts_used: attemptsUsed, status };
}

/** Recalculate eligible automatic scores after question marks or point changes. */
export async function rescoreQuizFromAnswers(
  tx: Prisma.TransactionClient,
  activityId: string,
  points: number,
  submissionId: string | null = null,
): Promise<number> {
  const submissions = await tx.submission.findMany({
    where: {
      activity_id: activityId,
      ...(submissionId ? { id: submissionId } : {}),
      graded_by: null,
      score: { not: null },
      quiz_started_at: null,
    },
    select: { id: true },
  });
  for (const submission of submissions) {
    await scoreQuizSubmission(tx, submission.id, points);
  }
  return submissions.length;
}
