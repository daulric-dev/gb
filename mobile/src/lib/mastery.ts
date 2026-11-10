/**
 * Mastery of learning outcomes (backend `src/mastery`). Mirrors the web
 * `frontend/lib/mastery.ts` wire types for `/portal/me/outcomes` and
 * `/parent/children/:id/outcomes`. Alongside grades; never changes them.
 */

export type Calculation = "most_recent" | "highest" | "mean" | "decaying_average";

export interface MasteryScale {
  levels: { value: number; label: string }[];
  masteryThreshold: number;
  calculation: Calculation;
  decayWeight: number;
  minEvidence: number;
  scoreBands: { minPercent: number; level: number }[];
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

export interface OutcomeProgress {
  id: string;
  code: string;
  title: string;
  description: string | null;
  parentId: string | null;
  setTitle: string | null;
  scope: "course" | "school";
  archived: boolean;
  mastery: MasteryResult;
  evidence: EvidenceItem[];
}

export interface MyOutcomes {
  scale: MasteryScale;
  courses: { courseId: string; courseName: string; courseCode: string | null; outcomes: OutcomeProgress[] }[];
}

export const MY_OUTCOMES_PATH = "/portal/me/outcomes";

export function parentOutcomesPath(studentId: string): string {
  return `/parent/children/${encodeURIComponent(studentId)}/outcomes`;
}

export type LevelTone = "none" | "low" | "mid" | "high" | "top";

/** Same rule as the web: top level, at/above the threshold, just below, the rest. */
export function levelTone(level: number | null, scale: Pick<MasteryScale, "levels" | "masteryThreshold">): LevelTone {
  if (level === null) return "none";
  const top = scale.levels.length;
  if (level >= top && top > scale.masteryThreshold) return "top";
  if (level >= scale.masteryThreshold) return "high";
  if (level === scale.masteryThreshold - 1) return "mid";
  return "low";
}

/** Readable on both themes; always shown with the label (never colour alone). */
export function toneColor(tone: LevelTone, scheme: "light" | "dark"): string | undefined {
  const light = { none: undefined, low: "#b91c1c", mid: "#b45309", high: "#047857", top: "#0369a1" };
  const dark = { none: undefined, low: "#fca5a5", mid: "#fcd34d", high: "#6ee7b7", top: "#7dd3fc" };
  return (scheme === "dark" ? dark : light)[tone];
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

/** "1 Oct 2026" in UTC, fixed month names. */
export function formatEvidenceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** What VoiceOver / TalkBack read for an outcome row. */
export function outcomeAccessibilityLabel(o: Pick<OutcomeProgress, "code" | "title" | "mastery">): string {
  const m = o.mastery;
  if (m.label === null) return `${o.code} ${o.title}: no evidence yet`;
  return `${o.code} ${o.title}: ${m.label}, ${STATUS_LABEL[m.status].toLowerCase()}, ${m.evidenceCount} piece${m.evidenceCount === 1 ? "" : "s"} of evidence`;
}
