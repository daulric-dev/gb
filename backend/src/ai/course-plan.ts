/**
 * Course plans (the AI course builder): turning the model's outline into a
 * clean plan the teacher edits, and the pure rules used when the reviewed
 * plan is created (due dates, group names, outcome codes). No I/O here.
 */
import {
  AI_MAX_QUESTIONS,
  AI_PLAN_MAX_ITEMS,
  AI_PLAN_MAX_MODULES,
  AI_PLAN_MAX_OUTCOMES,
  AI_SUBMISSION_TYPES,
  type AiPlanItemKind,
  type AiSubmissionType,
} from './ai.constants';
import { plainText, safeMarkdown } from './redact';

/** One item as the model answers it (see PLAN_ITEM_SCHEMA). */
export interface ModelPlanItem {
  kind: AiPlanItemKind;
  title: string;
  description: string;
  points: number | null;
  dueOffsetWeeks: number | null;
  questionCount: number | null;
  group: string;
  submission: '' | AiSubmissionType;
  outcomes: string[];
}

export interface ModelPlanModule {
  title: string;
  overview: string;
  items: ModelPlanItem[];
  outcomes: { code: string; title: string }[];
}

/** A plan item as the teacher sees and edits it (and sends back to create). */
export interface PlanItem {
  kind: AiPlanItemKind;
  title: string;
  description: string;
  points: number | null;
  dueOffsetWeeks: number | null;
  questionCount: number | null;
  group: string;
  submission: AiSubmissionType | null;
  outcomes: string[];
}

export interface PlanOutcome {
  code: string;
  title: string;
}

export interface PlanModule {
  title: string;
  overview: string;
  items: PlanItem[];
  outcomes: PlanOutcome[];
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() : s);
const line = (s: string | null | undefined, n: number) => clip(plainText((s ?? '').replace(/\s+/g, ' ')), n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Default points for an assessment the model left without any. */
export const DEFAULT_ASSIGNMENT_POINTS = 10;
export const DEFAULT_QUIZ_QUESTIONS = 5;

/**
 * One model (or teacher-sent) item made consistent: text cleaned (plain
 * text titles; descriptions safe Markdown, links only to URLs the teacher
 * supplied), fields that do not apply to the kind cleared, numbers in
 * range. Null when it has no title left.
 */
export function cleanPlanItem(
  raw: Partial<ModelPlanItem> & { kind: AiPlanItemKind; title: string },
  allowedUrls: Set<string> = new Set(),
  moduleCodes?: Set<string>,
): PlanItem | null {
  const title = line(raw.title, 200);
  if (!title) return null;
  const description = clip(safeMarkdown(raw.description ?? '', allowedUrls), 10_000);
  const assessment = raw.kind !== 'page';
  const weeks =
    assessment && raw.dueOffsetWeeks !== null && raw.dueOffsetWeeks !== undefined && Number.isFinite(raw.dueOffsetWeeks)
      ? clamp(Math.round(raw.dueOffsetWeeks), 0, 104)
      : null;
  const questionCount =
    raw.kind === 'quiz'
      ? clamp(Math.round(raw.questionCount ?? DEFAULT_QUIZ_QUESTIONS), 1, AI_MAX_QUESTIONS)
      : null;
  let points: number | null = null;
  if (raw.kind === 'assignment') {
    points = round2(clamp(raw.points ?? DEFAULT_ASSIGNMENT_POINTS, 0, 1000));
  } else if (raw.kind === 'quiz') {
    points = round2(clamp(raw.points ?? questionCount ?? DEFAULT_QUIZ_QUESTIONS, 0, 1000));
  }
  const submission =
    raw.kind === 'assignment'
      ? (AI_SUBMISSION_TYPES as readonly string[]).includes(raw.submission ?? '')
        ? (raw.submission as AiSubmissionType)
        : 'text'
      : null;
  const seen = new Set<string>();
  const outcomes = assessment
    ? (raw.outcomes ?? [])
        .map((c) => line(c, 64))
        .filter((c) => {
          const k = c.toLowerCase();
          if (!c || seen.has(k) || (moduleCodes && !moduleCodes.has(k))) return false;
          seen.add(k);
          return true;
        })
        .slice(0, AI_PLAN_MAX_OUTCOMES)
    : [];
  return {
    kind: raw.kind,
    title,
    description,
    points,
    dueOffsetWeeks: weeks,
    questionCount,
    group: assessment ? line(raw.group, 100) : '',
    submission,
    outcomes,
  };
}

/**
 * The model's outline as a plan: modules and items cleaned (see
 * cleanPlanItem), limits applied again, outcome codes unique across the
 * plan (a repeated code is dropped) and item outcome references limited to
 * their module's codes. `withOutcomes` false drops every outcome.
 */
export function cleanOutline(
  modules: ModelPlanModule[],
  opts: { allowedUrls?: Set<string>; withOutcomes: boolean },
): PlanModule[] {
  const allCodes = new Set<string>();
  const out: PlanModule[] = [];
  for (const m of modules.slice(0, AI_PLAN_MAX_MODULES)) {
    const title = line(m.title, 200);
    if (!title) continue;
    const outcomes: PlanOutcome[] = [];
    if (opts.withOutcomes) {
      for (const o of m.outcomes.slice(0, AI_PLAN_MAX_OUTCOMES)) {
        const code = line(o.code, 64);
        const otitle = line(o.title, 500);
        if (!code || !otitle || allCodes.has(code.toLowerCase())) continue;
        allCodes.add(code.toLowerCase());
        outcomes.push({ code, title: otitle });
      }
    }
    const codes = new Set(outcomes.map((o) => o.code.toLowerCase()));
    const items = m.items
      .slice(0, AI_PLAN_MAX_ITEMS)
      .map((i) => cleanPlanItem(i, opts.allowedUrls, codes))
      .filter((i): i is PlanItem => i !== null);
    out.push({ title, overview: line(m.overview, 1000), items, outcomes });
  }
  return out;
}

/**
 * A course's start as YYYY-MM-DD from its term, else academic year, start
 * date (UTC date columns), or null.
 */
export function startDateOf(...dates: (Date | string | null | undefined)[]): string | null {
  for (const d of dates) {
    if (!d) continue;
    const iso = typeof d === 'string' ? d : d.toISOString();
    if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  }
  return null;
}

/**
 * The due date of an item `offsetWeeks` weeks after `start` (YYYY-MM-DD):
 * that day at 23:59 UTC, as an ISO timestamp. Null without a start or an
 * offset (the item is created without a due date).
 */
export function dueDateFor(start: string | null, offsetWeeks: number | null | undefined): string | null {
  if (!start || offsetWeeks === null || offsetWeeks === undefined || !Number.isFinite(offsetWeeks)) return null;
  const [y, m, d] = start.split('-').map(Number);
  if (!y || !m || !d) return null;
  const at = new Date(Date.UTC(y, m - 1, d + Math.round(offsetWeeks) * 7, 23, 59, 0, 0));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Assignment group names the plan uses, unique case-insensitively, first spelling kept. */
export function planGroupNames(modules: { items: { kind: AiPlanItemKind; group?: string }[] }[]): string[] {
  const seen = new Map<string, string>();
  for (const m of modules) {
    for (const i of m.items) {
      if (i.kind === 'page') continue;
      const name = (i.group ?? '').trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

/** How an assignment accepts work, from the plan's submission type. */
export function submissionFlags(type: AiSubmissionType | null | undefined): { allowText: boolean; allowFile: boolean } {
  if (type === 'file') return { allowText: false, allowFile: true };
  if (type === 'text_and_file') return { allowText: true, allowFile: true };
  return { allowText: true, allowFile: false };
}
