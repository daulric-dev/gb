/**
 * Quiz question kinds: what each needs from the teacher, how a student's
 * answer is checked and stored, how it is scored, and how one attempt's
 * questions are drawn and shuffled.
 *
 * Scoring here (`questionCredit`) is shared by submit, expiry, rescore and
 * teacher per-question views, so the same rules write and display marks.
 */

import { BadRequestException } from '@nestjs/common';

export const QUESTION_KINDS = [
  'multiple_choice',
  'true_false',
  'short_answer',
  'essay',
  'multiple_select',
  'numeric',
  'matching',
  'ordering',
  'file_upload',
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** Marked by the teacher: the quiz waits ("needs marking") until they are. */
export const MANUAL_KINDS: readonly QuestionKind[] = ['essay', 'file_upload'];
/** Kinds with options a student picks from or arranges. */
const OPTION_KINDS: readonly QuestionKind[] = [
  'multiple_choice',
  'true_false',
  'multiple_select',
  'matching',
  'ordering',
];

export const MAX_SHORT_ANSWER = 500;
export const MAX_ESSAY = 50_000;
const MAX_FILE_TYPES = 20;
const FILE_TYPE = /^(\.[a-z0-9]{1,10}|[a-z]+\/([a-z0-9.+-]+|\*))$/i;

export function isManualKind(kind: string): boolean {
  return (MANUAL_KINDS as readonly string[]).includes(kind);
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

// ── teacher input ───────────────────────────────────────────────────────────

export type OptionInput = {
  label: string;
  isCorrect?: boolean;
  /** matching: the right-hand item this one matches. */
  matchLabel?: string | null;
};

export type QuestionSettingsInput = {
  numericAnswer?: number | null;
  numericTolerance?: number | null;
  scoring?: 'all_or_nothing' | 'partial';
  rubricId?: string | null;
  fileTypes?: string[];
  fileMaxMb?: number | null;
};

/** The per-kind columns of a question, and its options to store. */
export type QuestionColumns = {
  numeric_answer: number | null;
  numeric_tolerance: number;
  partial_credit: boolean;
  rubric_id: string | null;
  file_types: string[];
  file_max_mb: number | null;
};

/**
 * Check a question's options and settings for its kind and return what to
 * store. Options of the kinds that have none are dropped.
 */
export function validateQuestion(
  kind: QuestionKind,
  rawOptions: OptionInput[] | undefined,
  settings: QuestionSettingsInput,
): {
  options: { label: string; isCorrect: boolean; matchLabel: string | null }[];
  columns: QuestionColumns;
} {
  const options = (rawOptions ?? []).map((o) => ({
    label: (o.label ?? '').trim(),
    isCorrect: !!o.isCorrect,
    matchLabel: o.matchLabel?.trim() || null,
  }));
  const columns: QuestionColumns = {
    numeric_answer: null,
    numeric_tolerance: 0,
    partial_credit: false,
    rubric_id: null,
    file_types: [],
    file_max_mb: null,
  };
  if (options.some((o) => !o.label)) {
    throw new BadRequestException('Give every option a label');
  }

  switch (kind) {
    case 'short_answer':
      if (options.length < 1) {
        throw new BadRequestException('Add at least one accepted answer');
      }
      // Every accepted wording is a right answer.
      return {
        options: options.map((o) => ({ ...o, isCorrect: true, matchLabel: null })),
        columns,
      };
    case 'multiple_choice':
    case 'true_false': {
      if (options.length < 2) {
        throw new BadRequestException('A question needs at least two options');
      }
      const correct = options.filter((o) => o.isCorrect).length;
      if (correct === 0) throw new BadRequestException('Mark one option as correct');
      // Auto-grading picks a single option, so several correct ones would make
      // the score ambiguous rather than generous.
      if (correct > 1) throw new BadRequestException('Only one option can be correct');
      return { options: options.map((o) => ({ ...o, matchLabel: null })), columns };
    }
    case 'multiple_select':
      if (options.length < 2) {
        throw new BadRequestException('A question needs at least two options');
      }
      if (!options.some((o) => o.isCorrect)) {
        throw new BadRequestException('Mark at least one option as correct');
      }
      columns.partial_credit = settings.scoring === 'partial';
      return { options: options.map((o) => ({ ...o, matchLabel: null })), columns };
    case 'matching':
      if (options.length < 2) {
        throw new BadRequestException('A matching question needs at least two pairs');
      }
      if (options.some((o) => !o.matchLabel)) {
        throw new BadRequestException('Give every item a match');
      }
      columns.partial_credit = settings.scoring === 'partial';
      return { options: options.map((o) => ({ ...o, isCorrect: false })), columns };
    case 'ordering':
      if (options.length < 2) {
        throw new BadRequestException('An ordering question needs at least two items');
      }
      columns.partial_credit = settings.scoring === 'partial';
      // The order given is the right order.
      return {
        options: options.map((o) => ({ ...o, isCorrect: false, matchLabel: null })),
        columns,
      };
    case 'numeric': {
      const answer = settings.numericAnswer;
      if (answer === null || answer === undefined || !Number.isFinite(answer)) {
        throw new BadRequestException('Give the numeric answer');
      }
      const tolerance = settings.numericTolerance ?? 0;
      if (!Number.isFinite(tolerance) || tolerance < 0) {
        throw new BadRequestException('The tolerance must be 0 or more');
      }
      columns.numeric_answer = answer;
      columns.numeric_tolerance = tolerance;
      return { options: [], columns };
    }
    case 'essay':
      columns.rubric_id = settings.rubricId ?? null;
      return { options: [], columns };
    case 'file_upload': {
      const types = [
        ...new Set((settings.fileTypes ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)),
      ];
      if (types.length > MAX_FILE_TYPES || types.some((t) => !FILE_TYPE.test(t))) {
        throw new BadRequestException(
          'File types are extensions like .pdf or types like image/*, at most 20',
        );
      }
      const max = settings.fileMaxMb ?? null;
      if (max !== null && (!Number.isInteger(max) || max < 1 || max > 1000)) {
        throw new BadRequestException('The file size limit must be 1 to 1000 MB');
      }
      columns.file_types = types;
      columns.file_max_mb = max;
      return { options: [], columns };
    }
    default:
      throw new BadRequestException('Unknown question type');
  }
}

/** Whether a file the student uploads fits a file question's types. */
export function fileTypeAllowed(
  types: string[],
  file: { name: string; contentType: string },
): boolean {
  if (types.length === 0) return true;
  const name = file.name.toLowerCase();
  const mime = (file.contentType || '').toLowerCase();
  return types.some((t) => {
    if (t.startsWith('.')) return name.endsWith(t);
    if (t.endsWith('/*')) return mime.startsWith(t.slice(0, -1));
    return mime === t;
  });
}

// ── shared scoring ──────────────────────────────────────────────────────────

export type ScoringQuestion = {
  kind: string;
  points: number;
  numericAnswer: number | null;
  numericTolerance: number;
  partialCredit: boolean;
  /** In sort order. */
  options: { id: string; label: string; isCorrect: boolean; matchLabel: string | null }[];
};

export type StoredAnswer = {
  optionId?: string | null;
  optionIds?: string[] | null;
  matches?: Record<string, string> | null;
  text?: string | null;
  numeric?: number | null;
  fileId?: string | null;
  manualPoints?: number | null;
};

/**
 * One question's credit, 0 to 1, and whether it waits for the teacher (an
 * answered essay or file question with no mark yet).
 */
export function questionCredit(
  q: ScoringQuestion,
  a: StoredAnswer | null | undefined,
): { credit: number; needsMarking: boolean } {
  const none = { credit: 0, needsMarking: false };
  if (isManualKind(q.kind)) {
    const answered = !!a && (!!a.text?.trim() || !!a.fileId);
    if (a?.manualPoints === null || a?.manualPoints === undefined) {
      return { credit: 0, needsMarking: answered };
    }
    if (q.points <= 0) return none;
    return { credit: Math.min(a.manualPoints, q.points) / q.points, needsMarking: false };
  }
  if (!a) return none;
  const hit = (b: boolean) => ({ credit: b ? 1 : 0, needsMarking: false });
  switch (q.kind) {
    case 'short_answer': {
      const text = a.text;
      if (text === null || text === undefined) return none;
      const t = text.trim().toLowerCase();
      return hit(q.options.some((o) => o.isCorrect && o.label.trim().toLowerCase() === t));
    }
    case 'multiple_choice':
    case 'true_false':
      return hit(q.options.some((o) => o.id === a.optionId && o.isCorrect));
    case 'numeric':
      return hit(
        a.numeric !== null &&
          a.numeric !== undefined &&
          q.numericAnswer !== null &&
          // The database compares exact decimals; allow for binary floats.
          Math.abs(a.numeric - q.numericAnswer) - q.numericTolerance <= 1e-9,
      );
    case 'multiple_select': {
      const chosen = a.optionIds;
      const correct = q.options.filter((o) => o.isCorrect);
      if (!chosen || correct.length === 0) return none;
      const picked = new Set(chosen);
      if (q.partialCredit) {
        const right = correct.filter((o) => picked.has(o.id)).length;
        const wrong = q.options.filter((o) => !o.isCorrect && picked.has(o.id)).length;
        return { credit: Math.max(0, (right - wrong) / correct.length), needsMarking: false };
      }
      return hit(q.options.every((o) => picked.has(o.id) === o.isCorrect));
    }
    case 'matching': {
      if (!a.matches || q.options.length === 0) return none;
      const right = q.options.filter((o) => a.matches![o.id] === o.matchLabel).length;
      if (q.partialCredit) return { credit: right / q.options.length, needsMarking: false };
      return hit(right === q.options.length);
    }
    case 'ordering': {
      if (!a.optionIds || q.options.length === 0) return none;
      // 1-based place, as array_position is.
      const right = q.options.filter((o, i) => a.optionIds!.indexOf(o.id) + 1 === i + 1).length;
      if (q.partialCredit) return { credit: right / q.options.length, needsMarking: false };
      return hit(right === q.options.length);
    }
    default:
      return none;
  }
}

// ── one attempt's questions ─────────────────────────────────────────────────

/** A small deterministic generator (mulberry32), seeded per attempt. */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type PlanQuestion = { id: string; kind: string; optionIds: string[] };

export type AttemptPlanRow = {
  questionId: string;
  position: number;
  optionOrder: string[];
};

/**
 * The questions an attempt is given, in order, and the order of each one's
 * options. Deterministic for a seed, so it can be checked; the result is
 * stored when the attempt starts, which is what keeps resuming and
 * re-scoring stable.
 *
 * - The quiz's own questions, then `count` random questions from each bank
 *   draw (never the same question twice; fewer when the bank is smaller).
 * - `shuffleQuestions` shuffles the whole list.
 * - `shuffleOptions` shuffles multiple choice, multiple select and matching
 *   items. True/false keeps its order. Ordering items are always shuffled
 *   (in the right order they would give the answer away), and never left in
 *   the right order when there are two or more.
 */
export function buildAttemptPlan(
  seed: number,
  input: {
    fixed: PlanQuestion[];
    draws: { questions: PlanQuestion[]; count: number }[];
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
  },
): AttemptPlanRow[] {
  const random = seededRandom(seed);
  const chosen: PlanQuestion[] = [...input.fixed];
  const used = new Set(chosen.map((q) => q.id));
  for (const draw of input.draws) {
    const pool = draw.questions.filter((q) => !used.has(q.id));
    for (const q of shuffled(pool, random).slice(0, Math.max(0, draw.count))) {
      chosen.push(q);
      used.add(q.id);
    }
  }
  const ordered = input.shuffleQuestions ? shuffled(chosen, random) : chosen;
  return ordered.map((q, position) => {
    let optionOrder = q.optionIds;
    if (q.kind === 'ordering') {
      optionOrder = shuffled(q.optionIds, random);
      if (
        optionOrder.length > 1 &&
        optionOrder.every((id, i) => id === q.optionIds[i])
      ) {
        optionOrder = [...optionOrder.slice(1), optionOrder[0]];
      }
    } else if (
      input.shuffleOptions &&
      ['multiple_choice', 'multiple_select', 'matching'].includes(q.kind)
    ) {
      optionOrder = shuffled(q.optionIds, random);
    } else if (!OPTION_KINDS.includes(q.kind as QuestionKind)) {
      optionOrder = [];
    }
    return { questionId: q.id, position, optionOrder };
  });
}

// ── what the student sees ───────────────────────────────────────────────────

export type StudentQuestionSource = {
  id: string;
  prompt: string;
  kind: string;
  points: unknown;
  file_types?: unknown;
  file_max_mb?: number | null;
};

/**
 * A question as the student sees it: never the answer key. No `isCorrect`,
 * no numeric answer, no short-answer wordings (the labels are the key), and
 * for matching the right-hand items as a separate list in alphabetical order,
 * so which goes with which is not given away.
 */
export function toStudentQuestion(
  q: StudentQuestionSource,
  options: { id: string; label: string; match_label?: string | null }[],
  optionOrder?: string[] | null,
) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const ordered =
    optionOrder && optionOrder.length
      ? optionOrder.map((id) => byId.get(id)).filter((o): o is (typeof options)[number] => !!o)
      : options;
  const kind = q.kind;
  const base = {
    id: q.id,
    prompt: q.prompt,
    kind,
    points: Number(q.points),
    options:
      OPTION_KINDS.includes(kind as QuestionKind)
        ? ordered.map((o) => ({ id: o.id, label: o.label }))
        : [],
  };
  if (kind === 'matching') {
    return {
      ...base,
      matchChoices: [
        ...new Set(options.map((o) => o.match_label ?? '').filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b)),
    };
  }
  if (kind === 'file_upload') {
    return {
      ...base,
      fileTypes: stringList(q.file_types),
      fileMaxMb: q.file_max_mb ?? null,
    };
  }
  return base;
}

// ── student answers ─────────────────────────────────────────────────────────

export type AnswerInput = {
  questionId: string;
  optionId?: string;
  optionIds?: string[];
  matches?: { optionId: string; label: string }[];
  text?: string;
  numeric?: number;
  fileId?: string;
};

export type AnswerRow = {
  question_id: string;
  option_id: string | null;
  option_ids: string[];
  matches: Record<string, string> | null;
  text_answer: string | null;
  numeric_answer: number | null;
  file_id: string | null;
};

/**
 * A student's answer as a row to store, or null when it does not fit the
 * question (an option from another question, the wrong shape for the kind).
 * Answers that do not fit are dropped, as before, rather than refused.
 */
export function answerRow(
  q: { kind: string; optionIds: Set<string> },
  a: AnswerInput,
): AnswerRow | null {
  const row: AnswerRow = {
    question_id: a.questionId,
    option_id: null,
    option_ids: [],
    matches: null,
    text_answer: null,
    numeric_answer: null,
    file_id: null,
  };
  switch (q.kind) {
    case 'multiple_choice':
    case 'true_false':
      if (a.optionId === undefined) {
        // An older client clearing a choice sends text: keep it unanswered.
        return a.text !== undefined ? row : null;
      }
      if (!q.optionIds.has(a.optionId)) return null;
      row.option_id = a.optionId;
      return row;
    case 'short_answer':
    case 'essay': {
      if (a.text === undefined) return null;
      const text = a.text.trim();
      if (text.length > (q.kind === 'essay' ? MAX_ESSAY : MAX_SHORT_ANSWER)) return null;
      row.text_answer = text;
      return row;
    }
    case 'numeric':
      if (a.numeric === undefined || a.numeric === null || !Number.isFinite(a.numeric)) {
        return null;
      }
      row.numeric_answer = a.numeric;
      return row;
    case 'multiple_select':
    case 'ordering': {
      if (!Array.isArray(a.optionIds)) return null;
      const ids = [...new Set(a.optionIds)];
      if (ids.some((id) => !q.optionIds.has(id))) return null;
      row.option_ids = ids;
      return row;
    }
    case 'matching': {
      if (!Array.isArray(a.matches)) return null;
      const matches: Record<string, string> = {};
      for (const m of a.matches) {
        if (!q.optionIds.has(m.optionId)) return null;
        const label = (m.label ?? '').trim();
        if (label) matches[m.optionId] = label;
      }
      row.matches = matches;
      return row;
    }
    case 'file_upload':
      if (!a.fileId) return null;
      row.file_id = a.fileId;
      return row;
    default:
      return null;
  }
}

/** A stored answer as the student's client gets it back when resuming. */
export function toSavedAnswer(row: {
  question_id: string;
  option_id: string | null;
  text_answer: string | null;
  option_ids?: unknown;
  matches?: unknown;
  numeric_answer?: unknown;
  file_id?: string | null;
}) {
  const optionIds = stringList(row.option_ids);
  const matches =
    row.matches && typeof row.matches === 'object'
      ? Object.entries(row.matches as Record<string, string>).map(([optionId, label]) => ({
          optionId,
          label,
        }))
      : null;
  return {
    questionId: row.question_id,
    optionId: row.option_id,
    text: row.text_answer,
    optionIds: optionIds.length ? optionIds : null,
    matches,
    numeric:
      row.numeric_answer === null || row.numeric_answer === undefined
        ? null
        : Number(row.numeric_answer),
    fileId: row.file_id ?? null,
  };
}
