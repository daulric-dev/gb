import { api } from "@/lib/api";

/**
 * Similarity check (API `src/similarity`): teachers only. A marker is a
 * prompt to look, never a verdict, and students never see any of it.
 */

export interface SimilarityFlag {
  submissionId: string;
  studentId: string;
  count: number;
  maxScore: number;
}

export interface SimilarityFlags {
  threshold: number;
  pool: "activity" | "school";
  note: string;
  flags: SimilarityFlag[];
}

export interface SimilarityMatch {
  fingerprintId: string;
  otherId: string;
  part: string;
  partLabel: string;
  score: number;
  sameActivity: boolean;
  other: {
    submissionId: string | null;
    studentName: string | null;
    activityTitle: string;
    courseName: string;
    canView: boolean;
  };
}

export interface Segment {
  text: string;
  match: boolean;
}

export interface SimilarityComparison {
  score: number;
  note: string;
  left: { studentName: string; activityTitle: string; segments: Segment[] };
  right: {
    studentName: string | null;
    activityTitle: string;
    courseName: string;
    canView: boolean;
    segments: Segment[];
  };
}

export interface SimilaritySettings {
  pool: "activity" | "school";
  poolTerms: number;
  threshold: number;
}

export const similarityApi = {
  flags: (activityId: string) => api<SimilarityFlags>(`/activities/${activityId}/similarity`),
  matches: (activityId: string, submissionId: string) =>
    api<{ threshold: number; note: string; matches: SimilarityMatch[] }>(
      `/activities/${activityId}/similarity/submissions/${submissionId}`,
    ),
  compare: (activityId: string, fingerprintId: string, otherId: string) =>
    api<SimilarityComparison>(
      `/activities/${activityId}/similarity/compare/${fingerprintId}/${otherId}`,
    ),
  settings: () => api<SimilaritySettings>(`/schools/current/similarity`),
  saveSettings: (body: SimilaritySettings) =>
    api<SimilaritySettings>(`/schools/current/similarity`, { method: "PUT", body }),
};

/** "Similar to 2 submissions · 62%". */
export function similarityLabel(flag: Pick<SimilarityFlag, "count" | "maxScore">): string {
  const n = flag.count;
  return `Similar to ${n} submission${n === 1 ? "" : "s"} · ${flag.maxScore}%`;
}

/** The flags keyed by student, for the roster. */
export function flagsByStudent(flags: SimilarityFlag[] | null | undefined): Record<string, SimilarityFlag> {
  const out: Record<string, SimilarityFlag> = {};
  for (const f of flags ?? []) {
    const current = out[f.studentId];
    if (!current || f.maxScore > current.maxScore) out[f.studentId] = f;
  }
  return out;
}

/** Where a match comes from, for the list. */
export function matchSource(m: SimilarityMatch): string {
  if (m.sameActivity) return m.other.studentName ?? "Another student";
  const who = m.other.studentName ?? "A student in another course";
  return `${who} · ${m.other.activityTitle} (${m.other.courseName})`;
}
