/**
 * Reading and writing quiz questions, shared by a quiz's own questions
 * (ActivityService) and a question bank's (QuestionBankService): the same
 * kinds, rules and wire shape in both places.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import {
  validateQuestion,
  type OptionInput,
  type QuestionKind,
  type QuestionSettingsInput,
} from './quiz-questions';

export const QUESTION_SELECT = {
  id: true,
  activity_id: true,
  bank_id: true,
  prompt: true,
  kind: true,
  points: true,
  sort_order: true,
  numeric_answer: true,
  numeric_tolerance: true,
  partial_credit: true,
  rubric_id: true,
  file_types: true,
  file_max_mb: true,
} satisfies Prisma.quiz_questionSelect;

export const OPTION_SELECT = {
  id: true,
  question_id: true,
  label: true,
  is_correct: true,
  match_label: true,
  sort_order: true,
} satisfies Prisma.quiz_optionSelect;

type QuestionRow = Prisma.quiz_questionGetPayload<{ select: typeof QUESTION_SELECT }>;
type OptionRow = Prisma.quiz_optionGetPayload<{ select: typeof OPTION_SELECT }>;

export type QuestionInput = QuestionSettingsInput & {
  prompt: string;
  kind: QuestionKind;
  points?: number;
  options?: OptionInput[];
};

export type QuestionPatch = QuestionSettingsInput & {
  prompt?: string;
  points?: number;
  options?: OptionInput[];
};

/**
 * The `QuizQuestion` contract for staff: with the answer key unless
 * `includeAnswers` is false.
 */
export function toQuestion(
  q: QuestionRow,
  options: OptionRow[],
  includeAnswers = true,
) {
  const own = options
    .filter((o) => o.question_id === q.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: q.id,
    prompt: q.prompt,
    kind: q.kind,
    points: Number(q.points),
    sortOrder: q.sort_order,
    options: own.map((o) => ({
      id: o.id,
      label: o.label,
      sortOrder: o.sort_order,
      ...(includeAnswers
        ? { isCorrect: o.is_correct, matchLabel: o.match_label ?? null }
        : {}),
    })),
    ...(includeAnswers
      ? {
          numericAnswer:
            q.numeric_answer === null ? null : Number(q.numeric_answer),
          numericTolerance: Number(q.numeric_tolerance ?? 0),
        }
      : {}),
    scoring: q.partial_credit ? ('partial' as const) : ('all_or_nothing' as const),
    rubricId: q.rubric_id ?? null,
    fileTypes: q.file_types ?? [],
    fileMaxMb: q.file_max_mb ?? null,
  };
}

export type QuestionDto = ReturnType<typeof toQuestion>;

/** Questions with their options, in order. */
export async function loadQuestions(
  db: Pick<Prisma.TransactionClient, 'quiz_question' | 'quiz_option'>,
  where: Prisma.quiz_questionWhereInput,
  includeAnswers = true,
): Promise<QuestionDto[]> {
  const questions = await db.quiz_question.findMany({
    where,
    select: QUESTION_SELECT,
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  if (!questions?.length) return [];
  const options = await db.quiz_option.findMany({
    where: { question_id: { in: questions.map((q) => q.id) } },
    select: OPTION_SELECT,
    orderBy: { sort_order: 'asc' },
  });
  return questions.map((q) => toQuestion(q, options ?? [], includeAnswers));
}

/** An essay's rubric must be one of the course's own. */
async function checkRubric(
  db: Pick<Prisma.TransactionClient, 'rubric'>,
  courseId: string,
  rubricId: string | null,
) {
  if (!rubricId) return;
  const rubric = await db.rubric.findFirst({
    where: { id: rubricId, course_id: courseId },
    select: { id: true },
  });
  if (!rubric) throw new NotFoundException('Rubric not found');
}

function optionRows(
  questionId: string,
  options: { label: string; isCorrect: boolean; matchLabel: string | null }[],
) {
  return options.map((o, i) => ({
    question_id: questionId,
    label: o.label,
    is_correct: o.isCorrect,
    match_label: o.matchLabel,
    sort_order: i,
  }));
}

/** Audit shape of a question. */
export function questionAudit(q: {
  prompt: string;
  kind: string;
  points: unknown;
  options: { label: string; isCorrect?: boolean; matchLabel?: string | null }[];
  [k: string]: unknown;
}) {
  return {
    prompt: q.prompt,
    kind: q.kind,
    points: Number(q.points),
    options: q.options.map((o, i) => ({
      label: o.label,
      isCorrect: !!o.isCorrect,
      ...(o.matchLabel ? { matchLabel: o.matchLabel } : {}),
      sortOrder: i,
    })),
    numericAnswer: q.numericAnswer ?? null,
    numericTolerance: q.numericTolerance ?? null,
    scoring: q.scoring ?? null,
    rubricId: q.rubricId ?? null,
    fileTypes: q.fileTypes ?? null,
    fileMaxMb: q.fileMaxMb ?? null,
  };
}

/**
 * Add a question at the end of a quiz or bank, with its options, in the
 * caller's transaction.
 */
export async function createQuestion(
  tx: Prisma.TransactionClient,
  owner: { activityId: string } | { bankId: string },
  courseId: string,
  input: QuestionInput,
): Promise<QuestionDto> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new BadRequestException('Give the question a prompt');
  const { options, columns } = validateQuestion(input.kind, input.options, input);
  await checkRubric(tx, courseId, columns.rubric_id);

  const where =
    'activityId' in owner
      ? { activity_id: owner.activityId }
      : { bank_id: owner.bankId };
  const last = await tx.quiz_question.findFirst({
    where,
    select: { sort_order: true },
    orderBy: { sort_order: 'desc' },
  });
  const created = await tx.quiz_question.create({
    data: {
      ...where,
      prompt,
      kind: input.kind,
      points: input.points ?? 1,
      sort_order: (last?.sort_order ?? -1) + 1,
      ...columns,
    },
    select: QUESTION_SELECT,
  });
  if (options.length) {
    await tx.quiz_option.createMany({ data: optionRows(created.id, options) });
  }
  const saved = await tx.quiz_option.findMany({
    where: { question_id: created.id },
    select: OPTION_SELECT,
    orderBy: { sort_order: 'asc' },
  });
  return toQuestion(created, saved ?? []);
}

/**
 * Edit a question in place. Options are replaced as a whole list; settings
 * not sent keep their values. Returns the question before and after.
 */
export async function updateQuestionRow(
  tx: Prisma.TransactionClient,
  existing: QuestionRow,
  courseId: string,
  patch: QuestionPatch,
): Promise<{ before: QuestionDto; after: QuestionDto }> {
  const oldOptions = await tx.quiz_option.findMany({
    where: { question_id: existing.id },
    select: OPTION_SELECT,
    orderBy: { sort_order: 'asc' },
  });
  const before = toQuestion(existing, oldOptions ?? []);

  const prompt = patch.prompt === undefined ? existing.prompt : patch.prompt.trim();
  if (!prompt) throw new BadRequestException('Give the question a prompt');

  const settingsChanged = [
    patch.numericAnswer,
    patch.numericTolerance,
    patch.scoring,
    patch.rubricId,
    patch.fileTypes,
    patch.fileMaxMb,
  ].some((v) => v !== undefined);
  if (
    patch.prompt === undefined &&
    patch.points === undefined &&
    patch.options === undefined &&
    !settingsChanged
  ) {
    throw new BadRequestException('Nothing to update');
  }

  const merged: QuestionSettingsInput = {
    numericAnswer:
      patch.numericAnswer !== undefined ? patch.numericAnswer : before.numericAnswer,
    numericTolerance:
      patch.numericTolerance !== undefined
        ? patch.numericTolerance
        : before.numericTolerance,
    scoring: patch.scoring ?? before.scoring,
    rubricId: patch.rubricId !== undefined ? patch.rubricId : before.rubricId,
    fileTypes: patch.fileTypes ?? before.fileTypes,
    fileMaxMb: patch.fileMaxMb !== undefined ? patch.fileMaxMb : before.fileMaxMb,
  };
  const optionInput =
    patch.options ??
    before.options.map((o) => ({
      label: o.label,
      isCorrect: o.isCorrect,
      matchLabel: o.matchLabel,
    }));
  const { options, columns } = validateQuestion(
    existing.kind,
    optionInput,
    merged,
  );
  await checkRubric(tx, courseId, columns.rubric_id);

  const updated = await tx.quiz_question.update({
    where: { id: existing.id },
    data: {
      prompt,
      ...(patch.points !== undefined ? { points: patch.points } : {}),
      ...columns,
    },
    select: QUESTION_SELECT,
  });
  if (patch.options !== undefined) {
    await tx.quiz_option.deleteMany({ where: { question_id: existing.id } });
    if (options.length) {
      await tx.quiz_option.createMany({ data: optionRows(existing.id, options) });
    }
  }
  const newOptions =
    patch.options !== undefined
      ? await tx.quiz_option.findMany({
          where: { question_id: existing.id },
          select: OPTION_SELECT,
          orderBy: { sort_order: 'asc' },
        })
      : oldOptions;
  return { before, after: toQuestion(updated ?? existing, newOptions ?? []) };
}
