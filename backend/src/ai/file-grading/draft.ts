/**
 * Pure parts of AI grading drafts: fitting the work into the character
 * budget, building the user message, and turning the model's validated
 * answer into the draft the teacher sees (ids mapped back, text made plain,
 * evidence quotes kept only when they really are in the work sent).
 */
import { plainText, STUDENT_PLACEHOLDER } from '../redact';
import { TRUNCATION_MARKER, type DraftMode } from './file-grading.constants';
import type { RequirementStatus } from './file-grading.prompts';

export interface WorkPart {
  /** Shown to the model, e.g. `file 1 (essay.pdf)`; already redacted. */
  label: string;
  /** Redacted text. */
  text: string;
}

export interface AssembledWork {
  /** What goes inside <student_work>. */
  body: string;
  /** Characters of each part sent, in order. */
  sent: number[];
  /** Which parts were cut (or left out) to fit. */
  cut: boolean[];
  /** Characters of work text sent in all. */
  chars: number;
  truncated: boolean;
}

/**
 * The parts in order, each wrapped in a <part> tag, until `budget`
 * characters of work text have been used: the part that crosses it is cut
 * with TRUNCATION_MARKER and later parts are left out (and marked cut).
 */
export function assembleWork(parts: WorkPart[], budget: number): AssembledWork {
  let left = Math.max(0, budget);
  const blocks: string[] = [];
  const sent: number[] = [];
  const cut: boolean[] = [];
  for (const part of parts) {
    if (left <= 0) {
      sent.push(0);
      cut.push(true);
      continue;
    }
    let text = part.text;
    let wasCut = false;
    if (text.length > left) {
      // Cut at a word boundary close to the limit when there is one.
      const slice = text.slice(0, left);
      const space = slice.lastIndexOf(' ');
      text = space > left * 0.9 ? slice.slice(0, space) : slice;
      wasCut = true;
    }
    left -= text.length;
    sent.push(text.length);
    cut.push(wasCut);
    blocks.push(`<part source="${part.label.replace(/["<>]/g, '')}">\n${text}${wasCut ? `\n${TRUNCATION_MARKER}` : ''}\n</part>`);
  }
  const chars = sent.reduce((a, b) => a + b, 0);
  return { body: blocks.join('\n'), sent, cut, chars, truncated: cut.some(Boolean) };
}

export interface RubricForPrompt {
  title: string;
  criteria: {
    id: string;
    title: string;
    description: string | null;
    points: number;
    ratings: { id: string; label: string; description: string | null; points: number }[];
  }[];
}

export interface RubricRefs {
  criterion: Map<string, RubricForPrompt['criteria'][number]>;
  level: Map<string, { criterionId: string; id: string; label: string; points: number }>;
}

/** Rubric lines with short references (c1, c1-r2), never ids. `scrub` redacts teacher text. */
export function rubricLines(rubric: RubricForPrompt, scrub: (s: string) => string): { lines: string; refs: RubricRefs } {
  const refs: RubricRefs = { criterion: new Map(), level: new Map() };
  const lines: string[] = [`Rubric: ${scrub(rubric.title)}`];
  rubric.criteria.forEach((c, i) => {
    const ref = `c${i + 1}`;
    refs.criterion.set(ref, c);
    lines.push(`${ref}. ${scrub(c.title)} (${c.points} points)${c.description ? `: ${scrub(c.description)}` : ''}`);
    c.ratings.forEach((r, j) => {
      const lref = `${ref}-r${j + 1}`;
      refs.level.set(lref, { criterionId: c.id, id: r.id, label: r.label, points: r.points });
      lines.push(`  ${lref}. ${scrub(r.label)} (${r.points} points)${r.description ? `: ${scrub(r.description)}` : ''}`);
    });
  });
  return { lines: lines.join('\n'), refs };
}

export function userMessage(opts: {
  title: string;
  instructions: string | null;
  mode: DraftMode;
  points: number;
  rubricText?: string;
  work: AssembledWork;
  notes: string[];
}): string {
  return [
    `Activity: ${opts.title}`,
    opts.instructions ? `Instructions:\n${opts.instructions}` : 'Instructions: (none given)',
    '',
    opts.mode === 'rubric' ? (opts.rubricText ?? '') : `Points available: ${opts.points}`,
    '',
    ...(opts.notes.length ? ['Notes about the work:', ...opts.notes.map((n) => `- ${n}`), ''] : []),
    '<student_work>',
    opts.work.body,
    '</student_work>',
  ].join('\n');
}

// ── evidence ────────────────────────────────────────────────────────────

/** For matching quotes: case, whitespace, quote marks and dashes do not matter. */
export function normaliseForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ELLIPSIS_EDGES = /^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g;

/**
 * The quotes that appear in the work sent (after normalising), cleaned for
 * display; the rest are dropped. A quote with fewer than 3 letters or
 * digits says nothing and is dropped too.
 */
export function keepEvidence(quotes: readonly string[], haystack: string): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const raw of quotes) {
    const quote = plainText(typeof raw === 'string' ? raw : '').replace(/^["'“‘]+|["'”’]+$/g, '').replace(ELLIPSIS_EDGES, '');
    const needle = normaliseForMatch(quote);
    if ((needle.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3 || !haystack.includes(needle) || seen.has(needle)) {
      dropped++;
      continue;
    }
    seen.add(needle);
    kept.push(quote.length > 300 ? `${quote.slice(0, 297)}...` : quote);
  }
  return { kept, dropped };
}

// ── cleaning the model's answer ─────────────────────────────────────────

export interface ModelRubricAnswer {
  criteria: { criterion: string; level: string; comment: string; evidence: string[] }[];
  feedback: string;
  feedbackEvidence: string[];
}

export interface ModelScoreAnswer {
  score: number;
  requirements: { requirement: string; status: RequirementStatus; comment: string; evidence: string[] }[];
  feedback: string;
  feedbackEvidence: string[];
}

export interface RubricDraftCriterion {
  criterionId: string;
  title: string;
  maxPoints: number;
  ratingId: string | null;
  ratingLabel: string | null;
  points: number | null;
  comment: string;
  evidence: string[];
}

export interface RubricDraft {
  mode: 'rubric';
  criteria: RubricDraftCriterion[];
  suggestedTotal: number;
  feedback: string;
  feedbackEvidence: string[];
  evidenceDropped: number;
}

export interface ScoreDraft {
  mode: 'score';
  score: number;
  points: number;
  requirements: { requirement: string; status: RequirementStatus; comment: string; evidence: string[] }[];
  feedback: string;
  feedbackEvidence: string[];
  evidenceDropped: number;
}

export type GradingDraft = RubricDraft | ScoreDraft;

/** Model text for the teacher: plain, the student placeholder back to their first name. */
export function restorer(firstName: string | null | undefined) {
  return (s: string) => {
    const clean = plainText(typeof s === 'string' ? s : '');
    return firstName ? clean.split(STUDENT_PLACEHOLDER).join(firstName) : clean;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The rubric draft: every criterion of the rubric in order (one the model
 * skipped has no level), a level only when it belongs to that criterion,
 * evidence only when found in the work (`haystack` = normalised work sent).
 */
export function cleanRubricAnswer(
  answer: ModelRubricAnswer,
  rubric: RubricForPrompt,
  refs: RubricRefs,
  haystack: string,
  restore: (s: string) => string,
): RubricDraft {
  let dropped = 0;
  const byCriterion = new Map<string, ModelRubricAnswer['criteria'][number]>();
  for (const s of answer.criteria) {
    const c = refs.criterion.get(s.criterion);
    if (c && !byCriterion.has(c.id)) byCriterion.set(c.id, s);
  }
  const criteria = rubric.criteria.map((c): RubricDraftCriterion => {
    const s = byCriterion.get(c.id);
    const level = s?.level ? refs.level.get(s.level) : undefined;
    const valid = level && level.criterionId === c.id ? level : null;
    const ev = keepEvidence(s?.evidence ?? [], haystack);
    dropped += ev.dropped;
    return {
      criterionId: c.id,
      title: c.title,
      maxPoints: c.points,
      ratingId: valid?.id ?? null,
      ratingLabel: valid?.label ?? null,
      points: valid?.points ?? null,
      comment: s ? restore(s.comment) : '',
      evidence: ev.kept.map(restore),
    };
  });
  const fev = keepEvidence(answer.feedbackEvidence, haystack);
  return {
    mode: 'rubric',
    criteria,
    suggestedTotal: round2(criteria.reduce((sum, c) => sum + (c.points ?? 0), 0)),
    feedback: restore(answer.feedback),
    feedbackEvidence: fev.kept.map(restore),
    evidenceDropped: dropped + fev.dropped,
  };
}

/** The score draft: score clamped to 0..points (two decimals), checklist made plain, evidence checked. */
export function cleanScoreAnswer(
  answer: ModelScoreAnswer,
  points: number,
  haystack: string,
  restore: (s: string) => string,
): ScoreDraft {
  let dropped = 0;
  const requirements = answer.requirements
    .map((r) => {
      const ev = keepEvidence(r.evidence, haystack);
      dropped += ev.dropped;
      return { requirement: restore(r.requirement), status: r.status, comment: restore(r.comment), evidence: ev.kept.map(restore) };
    })
    .filter((r) => r.requirement);
  const fev = keepEvidence(answer.feedbackEvidence, haystack);
  const score = Number.isFinite(answer.score) ? round2(Math.min(Math.max(answer.score, 0), points)) : 0;
  return {
    mode: 'score',
    score,
    points,
    requirements,
    feedback: restore(answer.feedback),
    feedbackEvidence: fev.kept.map(restore),
    evidenceDropped: dropped + fev.dropped,
  };
}
