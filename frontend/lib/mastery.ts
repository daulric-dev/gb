/**
 * Mastery / standards-based grading (backend `src/mastery`): API shapes and
 * pure helpers shared by the course mastery grid, the outcome pages, the
 * student portal and the parent portal. Mastery sits alongside the points
 * gradebook and never changes a grade.
 */

export type Calculation = "most_recent" | "highest" | "mean" | "decaying_average";

export const CALCULATION_LABEL: Record<Calculation, string> = {
  most_recent: "Most recent",
  highest: "Highest",
  mean: "Average (mean)",
  decaying_average: "Decaying average",
};

export interface ScoreBand {
  minPercent: number;
  level: number;
}

/** GET/PUT /mastery/settings */
export interface MasteryScale {
  levels: { value: number; label: string }[];
  masteryThreshold: number;
  calculation: Calculation;
  decayWeight: number;
  minEvidence: number;
  scoreBands: ScoreBand[];
  reportCardSection: boolean;
}

export type MasteryStatus = "no_evidence" | "mastered" | "not_yet" | "needs_more_evidence";

export interface MasteryResult {
  score: number | null;
  level: number | null;
  label: string | null;
  status: MasteryStatus;
  mastered: boolean;
  evidenceCount: number;
}

export interface Outcome {
  id: string;
  setId: string | null;
  courseId: string | null;
  parentId: string | null;
  code: string;
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  position: number;
  archived: boolean;
}

/** GET /mastery/outcome-sets */
export interface OutcomeSetSummary {
  id: string;
  title: string;
  description: string | null;
  source: string | null;
  archived: boolean;
  outcomeCount: number;
  createdAt: string;
}

/** GET /mastery/outcome-sets/:id */
export interface OutcomeSet {
  id: string;
  title: string;
  description: string | null;
  source: string | null;
  archived: boolean;
  outcomes: (Outcome & { evidenceCount: number })[];
}

/** POST /mastery/outcome-sets/import */
export interface ImportResult {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
  set?: OutcomeSet;
}

export type AlignmentKind = "activity" | "criterion" | "question";

export interface Alignment {
  id: string;
  outcomeId: string;
  outcomeCode: string | null;
  outcomeTitle: string | null;
  kind: AlignmentKind;
  activityId: string | null;
  criterionId: string | null;
  questionId: string | null;
  label: string;
}

export interface AlignmentTarget {
  id: string;
  title: string;
  kind: "quiz" | "assignment" | "offline" | string;
  status: string;
  rubric: { id: string; title: string; criteria: { id: string; title: string }[] } | null;
  questions: { id: string; prompt: string; kind: string }[];
}

/** GET /courses/:id/outcomes */
export interface CourseOutcomes {
  canEdit: boolean;
  own: Outcome[];
  school: (Outcome & { setTitle: string | null })[];
  alignments: Alignment[];
  targets: AlignmentTarget[];
}

export interface OutcomeColumn {
  id: string;
  code: string;
  title: string;
  description: string | null;
  parentId: string | null;
  setTitle: string | null;
  scope: "course" | "school";
  archived: boolean;
}

/** GET /courses/:id/mastery */
export interface MasteryGrid {
  course: { id: string; name: string; code: string | null };
  scale: MasteryScale;
  outcomes: OutcomeColumn[];
  students: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    studentNumber: string | null;
    masteredCount: number;
    cells: (MasteryResult & { outcomeId: string })[];
  }[];
}

export interface EvidenceItem {
  id: string;
  activityId: string;
  activityTitle: string;
  source: "activity" | "rubric" | "question";
  detail: string | null;
  level: number;
  label: string | null;
  percent: number;
  assessedAt: string;
}

export interface OutcomeProgress extends OutcomeColumn {
  mastery: MasteryResult;
  evidence: EvidenceItem[];
}

/** GET /courses/:id/mastery/students/:studentId */
export interface StudentMastery {
  student: { id: string; firstName: string | null; lastName: string | null };
  scale: MasteryScale;
  outcomes: OutcomeProgress[];
}

/** GET /portal/me/outcomes, GET /parent/children/:id/outcomes */
export interface MyOutcomes {
  scale: MasteryScale;
  courses: { courseId: string; courseName: string; courseCode: string | null; outcomes: OutcomeProgress[] }[];
}

// ── helpers ────────────────────────────────────────────────────────────────

export type LevelTone = "none" | "low" | "mid" | "high" | "top";

/**
 * A tone for a level, from its place on the scale: the top level is `top`,
 * the mastery threshold and above `high`, the level just below `mid`, the
 * rest `low`. Always shown with the label, never colour alone.
 */
export function levelTone(level: number | null, scale: Pick<MasteryScale, "levels" | "masteryThreshold">): LevelTone {
  if (level === null) return "none";
  const top = scale.levels.length;
  if (level >= top && top > scale.masteryThreshold) return "top";
  if (level >= scale.masteryThreshold) return "high";
  if (level === scale.masteryThreshold - 1) return "mid";
  return "low";
}

export const STATUS_LABEL: Record<MasteryStatus, string> = {
  no_evidence: "No evidence yet",
  mastered: "Mastered",
  not_yet: "Not yet mastered",
  needs_more_evidence: "Needs more evidence",
};

export const SOURCE_LABEL: Record<EvidenceItem["source"], string> = {
  activity: "Whole activity",
  rubric: "Rubric row",
  question: "Quiz question",
};

/** "Proficient · 3.25" for a cell, or "-" without evidence. */
export function cellText(r: Pick<MasteryResult, "label" | "score">): string {
  if (r.label === null || r.score === null) return "-";
  return `${r.label} · ${r.score}`;
}

/** What a cell says to a screen reader. */
export function cellDescription(r: MasteryResult, outcome: { code: string; title: string }): string {
  const base = `${outcome.code} ${outcome.title}`;
  if (r.label === null) return `${base}: no evidence yet`;
  const count = `${r.evidenceCount} piece${r.evidenceCount === 1 ? "" : "s"} of evidence`;
  return `${base}: ${r.label}, score ${r.score}, ${STATUS_LABEL[r.status].toLowerCase()}, ${count}`;
}

/** Outcomes nested by parent (roots in order), each with its depth. */
export function nestOutcomes<T extends { id: string; parentId: string | null }>(
  list: T[],
): (T & { depth: number })[] {
  const ids = new Set(list.map((o) => o.id));
  const children = new Map<string | null, T[]>();
  for (const o of list) {
    const key = o.parentId && ids.has(o.parentId) ? o.parentId : null;
    children.set(key, [...(children.get(key) ?? []), o]);
  }
  const out: (T & { depth: number })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const o of children.get(parent) ?? []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push({ ...o, depth });
      walk(o.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left (a loop) goes at the end, flat.
  for (const o of list) if (!seen.has(o.id)) out.push({ ...o, depth: 0 });
  return out;
}

/** Evenly spaced bands for `n` levels (the server's default for a new count). */
export function defaultBands(n: number): ScoreBand[] {
  if (n === 4) {
    return [
      { minPercent: 0, level: 1 },
      { minPercent: 50, level: 2 },
      { minPercent: 70, level: 3 },
      { minPercent: 90, level: 4 },
    ];
  }
  return Array.from({ length: n }, (_, i) => ({ minPercent: Math.round((100 * i) / n), level: i + 1 }));
}

/** The reason a scale draft cannot be saved, or null. Mirrors the server. */
export function scaleError(s: {
  levels: string[];
  masteryThreshold: number;
  decayWeight: number;
  minEvidence: number;
  scoreBands: ScoreBand[];
}): string | null {
  const n = s.levels.length;
  if (n < 2 || n > 10) return "A scale has 2 to 10 levels";
  const seen = new Set<string>();
  for (const l of s.levels) {
    const t = l.trim();
    if (!t || t.length > 40) return "Each level needs a label of 1 to 40 characters";
    if (seen.has(t.toLowerCase())) return "Level labels must be different";
    seen.add(t.toLowerCase());
  }
  if (s.masteryThreshold < 1 || s.masteryThreshold > n) return `The mastery level must be between 1 and ${n}`;
  if (!(s.decayWeight > 0 && s.decayWeight < 1)) return "The decaying average weight must be between 0 and 1";
  if (!Number.isInteger(s.minEvidence) || s.minEvidence < 1 || s.minEvidence > 20) return "Minimum evidence must be 1 to 20";
  const b = s.scoreBands;
  if (b.length === 0) return "Add at least one score band";
  if (b[0].minPercent !== 0) return "The first score band must start at 0%";
  for (let i = 0; i < b.length; i++) {
    if (!(b[i].minPercent >= 0 && b[i].minPercent <= 100)) return "Score bands start between 0% and 100%";
    if (b[i].level < 1 || b[i].level > n) return `Score band levels must be between 1 and ${n}`;
    if (i > 0 && (b[i].minPercent <= b[i - 1].minPercent || b[i].level <= b[i - 1].level)) {
      return "Score bands must go up in both percent and level";
    }
  }
  return null;
}

/** "1 Oct 2026", in UTC (fixed month names, like the report PDFs). */
export function formatEvidenceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Describes how mastery is worked out, for the apps' "How is this calculated?" text. */
export function calculationSummary(scale: Pick<MasteryScale, "calculation" | "decayWeight" | "minEvidence" | "levels" | "masteryThreshold">): string {
  const method =
    scale.calculation === "decaying_average"
      ? `a decaying average (the newest evidence counts ${Math.round(scale.decayWeight * 100)}%)`
      : scale.calculation === "most_recent"
        ? "the most recent evidence"
        : scale.calculation === "highest"
          ? "the highest evidence"
          : "the average of all evidence";
  const threshold = scale.levels.find((l) => l.value === scale.masteryThreshold)?.label ?? `level ${scale.masteryThreshold}`;
  const min = scale.minEvidence > 1 ? `, with at least ${scale.minEvidence} pieces of evidence` : "";
  return `Mastery uses ${method}. An outcome is mastered at ${threshold} or above${min}. Late penalties never count.`;
}
