/**
 * Mastery rules, as pure functions: the school's proficiency scale, how a
 * piece of evidence becomes a level, how a student's evidence on one outcome
 * becomes a mastery score, and the outcome CSV format. Nothing here touches
 * the points gradebook.
 */

export const CALCULATIONS = ['most_recent', 'highest', 'mean', 'decaying_average'] as const;
export type Calculation = (typeof CALCULATIONS)[number];

export const MIN_LEVELS = 2;
export const MAX_LEVELS = 10;
export const MAX_LABEL = 40;

export interface ScoreBand {
  /** Lowest percent (0-100) that earns `level`. */
  minPercent: number;
  /** Level value, 1..levels.length. */
  level: number;
}

export interface MasteryScale {
  /** Labels lowest first; level value = position + 1. */
  levels: string[];
  /** Level value at or above which an outcome is mastered. */
  masteryThreshold: number;
  calculation: Calculation;
  /** decaying_average: weight of the newest evidence, 0 < w < 1. */
  decayWeight: number;
  /** Evidence items needed before "mastered". */
  minEvidence: number;
  scoreBands: ScoreBand[];
  /** Report cards show an outcomes section per course. */
  reportCardSection: boolean;
}

/** Evenly spaced bands for `n` levels: level k from (k-1)/n of the way. */
export function defaultBands(n: number): ScoreBand[] {
  if (n === 4) {
    return [
      { minPercent: 0, level: 1 },
      { minPercent: 50, level: 2 },
      { minPercent: 70, level: 3 },
      { minPercent: 90, level: 4 },
    ];
  }
  return Array.from({ length: n }, (_, i) => ({
    minPercent: Math.round((100 * i) / n),
    level: i + 1,
  }));
}

export const DEFAULT_SCALE: MasteryScale = {
  levels: ['Beginning', 'Developing', 'Proficient', 'Exceeding'],
  masteryThreshold: 3,
  calculation: 'decaying_average',
  decayWeight: 0.65,
  minEvidence: 1,
  scoreBands: defaultBands(4),
  reportCardSection: false,
};

/** Returns the reason a scale is invalid, or null. */
export function validateScale(s: MasteryScale): string | null {
  const n = s.levels.length;
  if (n < MIN_LEVELS || n > MAX_LEVELS) return `A scale has ${MIN_LEVELS} to ${MAX_LEVELS} levels`;
  const seen = new Set<string>();
  for (const label of s.levels) {
    const t = label.trim();
    if (!t || t.length > MAX_LABEL) return `Each level needs a label of 1 to ${MAX_LABEL} characters`;
    if (seen.has(t.toLowerCase())) return 'Level labels must be different';
    seen.add(t.toLowerCase());
  }
  if (!Number.isInteger(s.masteryThreshold) || s.masteryThreshold < 1 || s.masteryThreshold > n) {
    return `The mastery level must be between 1 and ${n}`;
  }
  if (!CALCULATIONS.includes(s.calculation)) return 'Unknown calculation method';
  if (!(s.decayWeight > 0 && s.decayWeight < 1)) return 'The decaying average weight must be between 0 and 1';
  if (!Number.isInteger(s.minEvidence) || s.minEvidence < 1 || s.minEvidence > 20) {
    return 'Minimum evidence must be 1 to 20';
  }
  const bands = s.scoreBands;
  if (bands.length < 1) return 'Add at least one score band';
  if (bands[0].minPercent !== 0) return 'The first score band must start at 0%';
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (!Number.isFinite(b.minPercent) || b.minPercent < 0 || b.minPercent > 100) {
      return 'Score bands start between 0% and 100%';
    }
    if (!Number.isInteger(b.level) || b.level < 1 || b.level > n) {
      return `Score band levels must be between 1 and ${n}`;
    }
    if (i > 0 && (b.minPercent <= bands[i - 1].minPercent || b.level <= bands[i - 1].level)) {
      return 'Score bands must go up in both percent and level';
    }
  }
  return null;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** A stored mastery_setting row (or null) as a scale; invalid parts fall back to the defaults. */
export function scaleFromRow(
  row: {
    levels: unknown;
    mastery_threshold: number;
    calculation: string;
    decay_weight: unknown;
    min_evidence: number;
    score_bands: unknown;
    report_card_section: boolean;
  } | null,
): MasteryScale {
  if (!row) return { ...DEFAULT_SCALE, levels: [...DEFAULT_SCALE.levels], scoreBands: [...DEFAULT_SCALE.scoreBands] };
  const levels = Array.isArray(row.levels) && row.levels.every((l) => typeof l === 'string')
    ? (row.levels)
    : DEFAULT_SCALE.levels;
  const bands = Array.isArray(row.score_bands)
    ? (row.score_bands as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => ({ minPercent: num(b.minPercent, NaN), level: num(b.level, NaN) }))
    : [];
  const scale: MasteryScale = {
    levels,
    masteryThreshold: row.mastery_threshold,
    calculation: (CALCULATIONS as readonly string[]).includes(row.calculation)
      ? (row.calculation as Calculation)
      : DEFAULT_SCALE.calculation,
    decayWeight: num(row.decay_weight, DEFAULT_SCALE.decayWeight),
    minEvidence: row.min_evidence,
    scoreBands: bands,
    reportCardSection: row.report_card_section,
  };
  if (validateScale({ ...scale })) {
    // A broken bands array falls back to bands for the stored levels.
    const fixed = { ...scale, scoreBands: defaultBands(levels.length) };
    return validateScale(fixed) ? { ...DEFAULT_SCALE } : fixed;
  }
  return scale;
}

// ── evidence → level ───────────────────────────────────────────────────────

/** The level a percent (0-100) earns: the band with the highest start at or below it. */
export function levelForPercent(bands: ScoreBand[], percent: number): number {
  let level = bands[0]?.level ?? 1;
  for (const b of bands) {
    if (percent + 1e-9 >= b.minPercent) level = b.level;
  }
  return level;
}

/**
 * A rubric rating's rank (0 = the lowest of `count` ratings) mapped onto a
 * scale of `levels` levels, proportionally: the lowest rating is level 1,
 * the highest the top level, and in between evenly (rounded). With as many
 * ratings as levels it is one to one.
 */
export function levelForRank(rank: number, count: number, levels: number): number {
  if (count <= 1) return levels;
  const r = Math.min(Math.max(rank, 0), count - 1);
  return 1 + Math.round((r / (count - 1)) * (levels - 1));
}

export interface EvidenceInput {
  /** Earned over possible, 0..1, before any late penalty. */
  ratio: number;
  ratingRank: number | null;
  ratingCount: number | null;
}

/** A piece of evidence's level on the school's scale. */
export function evidenceLevel(e: EvidenceInput, scale: MasteryScale): number {
  if (e.ratingRank !== null && e.ratingCount !== null && e.ratingCount >= 2) {
    return levelForRank(e.ratingRank, e.ratingCount, scale.levels.length);
  }
  return levelForPercent(scale.scoreBands, Math.min(Math.max(e.ratio, 0), 1) * 100);
}

// ── evidence → mastery ─────────────────────────────────────────────────────

export interface TimedLevel {
  level: number;
  /** When it was assessed; ties keep the given order. */
  at: Date;
}

/**
 * Decaying average, oldest to newest: start at the first level, then each
 * newer level counts `weight` and everything before it `1 - weight`.
 * [2, 3, 4] at 0.65: 2 → 0.35×2 + 0.65×3 = 2.65 → 0.35×2.65 + 0.65×4 = 3.5275.
 */
export function decayingAverage(levels: number[], weight: number): number {
  if (levels.length === 0) return 0;
  let avg = levels[0];
  for (let i = 1; i < levels.length; i++) avg = avg * (1 - weight) + levels[i] * weight;
  return avg;
}

/** The score (a level value, possibly fractional) from evidence, or null without any. */
export function masteryScore(items: TimedLevel[], calculation: Calculation, decayWeight: number): number | null {
  if (items.length === 0) return null;
  const ordered = items
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.i - b.i)
    .map((x) => x.level);
  switch (calculation) {
    case 'most_recent':
      return ordered[ordered.length - 1];
    case 'highest':
      return Math.max(...ordered);
    case 'mean':
      return ordered.reduce((s, v) => s + v, 0) / ordered.length;
    case 'decaying_average':
      return decayingAverage(ordered, decayWeight);
  }
}

/** The level a score falls in: the highest level at or below it (never below 1). */
export function levelForScore(score: number, levels: number): number {
  return Math.min(levels, Math.max(1, Math.floor(score + 1e-9)));
}

export type MasteryStatus = 'no_evidence' | 'mastered' | 'not_yet' | 'needs_more_evidence';

export interface MasteryResult {
  /** Rounded to two decimals; null with no evidence. */
  score: number | null;
  /** 1..n; null with no evidence. */
  level: number | null;
  label: string | null;
  status: MasteryStatus;
  mastered: boolean;
  evidenceCount: number;
}

/**
 * One student's mastery of one outcome. Mastered when the score reaches the
 * threshold and there are at least `minEvidence` items; a score at the
 * threshold with too few items is `needs_more_evidence`.
 */
export function calculateMastery(items: TimedLevel[], scale: MasteryScale): MasteryResult {
  const raw = masteryScore(items, scale.calculation, scale.decayWeight);
  if (raw === null) {
    return { score: null, level: null, label: null, status: 'no_evidence', mastered: false, evidenceCount: 0 };
  }
  const score = Math.round(raw * 100) / 100;
  const level = levelForScore(raw, scale.levels.length);
  const reached = raw + 1e-9 >= scale.masteryThreshold;
  const enough = items.length >= scale.minEvidence;
  const mastered = reached && enough;
  return {
    score,
    level,
    label: scale.levels[level - 1] ?? null,
    status: mastered ? 'mastered' : reached ? 'needs_more_evidence' : 'not_yet',
    mastered,
    evidenceCount: items.length,
  };
}

// ── outcome CSV ────────────────────────────────────────────────────────────

export interface OutcomeCsvRow {
  line: number;
  code: string;
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  parentCode: string | null;
}

export const OUTCOME_CSV_HEADERS = ['code', 'title', 'description', 'subject', 'grade_level', 'parent_code'];

const HEADER_ALIASES: Record<string, string> = {
  code: 'code',
  id: 'code',
  title: 'title',
  name: 'title',
  outcome: 'title',
  description: 'description',
  subject: 'subject',
  grade_level: 'grade_level',
  gradelevel: 'grade_level',
  grade: 'grade_level',
  parent_code: 'parent_code',
  parent: 'parent_code',
  parentcode: 'parent_code',
};

/**
 * Outcome rows from a CSV with a header row: `code` and `title` required,
 * `description`, `subject`, `grade_level`, `parent_code` optional (a parent
 * must appear in the same file). Returns rows and any errors (line numbers
 * are 1-based, the header is line 1).
 */
export function parseOutcomeCsv(
  input: { line: number; cells: string[] }[],
): { rows: OutcomeCsvRow[]; errors: { line: number; message: string }[] } {
  const errors: { line: number; message: string }[] = [];
  const nonEmpty = input.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }] };
  const header = nonEmpty[0].cells.map(
    (h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null,
  );
  const col = (name: string) => header.indexOf(name);
  if (col('code') < 0 || col('title') < 0) {
    return { rows: [], errors: [{ line: nonEmpty[0].line, message: 'The header needs code and title columns' }] };
  }
  const out: OutcomeCsvRow[] = [];
  const seen = new Set<string>();
  const cell = (r: string[], name: string) => {
    const i = col(name);
    const v = i < 0 ? '' : (r[i] ?? '').trim();
    return v === '' ? null : v;
  };
  for (const { line, cells: r } of nonEmpty.slice(1)) {
    const code = cell(r, 'code');
    const title = cell(r, 'title');
    if (!code || !title) {
      errors.push({ line, message: 'Each row needs a code and a title' });
      continue;
    }
    if (code.length > 64) errors.push({ line, message: `Code "${code.slice(0, 20)}…" is longer than 64 characters` });
    if (title.length > 500) errors.push({ line, message: 'Title is longer than 500 characters' });
    if (seen.has(code)) errors.push({ line, message: `Code ${code} appears twice` });
    seen.add(code);
    out.push({
      line,
      code,
      title,
      description: cell(r, 'description'),
      subject: cell(r, 'subject'),
      gradeLevel: cell(r, 'grade_level'),
      parentCode: cell(r, 'parent_code'),
    });
  }
  for (const r of out) {
    if (r.parentCode && !seen.has(r.parentCode)) {
      errors.push({ line: r.line, message: `Parent ${r.parentCode} is not in the file` });
    }
    if (r.parentCode === r.code) errors.push({ line: r.line, message: 'An outcome cannot be its own parent' });
  }
  // Cycles (A → B → A) would leave neither placeable.
  const parentOf = new Map(out.map((r) => [r.code, r.parentCode]));
  for (const r of out) {
    const visited = new Set<string>([r.code]);
    let p = r.parentCode;
    while (p && parentOf.has(p)) {
      if (visited.has(p)) {
        errors.push({ line: r.line, message: `Outcome ${r.code} is part of a parent loop` });
        break;
      }
      visited.add(p);
      p = parentOf.get(p) ?? null;
    }
  }
  if (out.length > 2000) errors.push({ line: 1, message: 'Import at most 2000 outcomes at a time' });
  return { rows: out, errors };
}

/** Rows ordered so every parent comes before its children. */
export function parentsFirst(rows: OutcomeCsvRow[]): OutcomeCsvRow[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const depth = (r: OutcomeCsvRow): number => {
    let d = 0;
    let p = r.parentCode;
    const seen = new Set<string>();
    while (p && byCode.has(p) && !seen.has(p)) {
      seen.add(p);
      d++;
      p = byCode.get(p)!.parentCode;
    }
    return d;
  };
  return rows
    .map((r, i) => ({ r, i, d: depth(r) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.r);
}
