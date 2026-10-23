/**
 * Course grades, as a student sees them.
 *
 * Mirrors the web portal's wire types (frontend/lib/courses/types.ts) so both
 * clients read the same responses from /portal/me/courses/:courseId/grades.
 */

import type { WorkKind } from "@/lib/work";
import { formatScore } from "@/lib/format-number";

export type SubmissionStatus = "draft" | "submitted" | "graded";

export interface AssignmentGroup {
  id: string;
  courseId: string;
  name: string;
  /** Percent of the course total; null when the course is unweighted. */
  weight: number | null;
  position: number;
  /** Drop rules; absent on older servers. */
  dropLowest?: number;
  dropHighest?: number;
}

export interface GroupScore {
  /** null for the implicit "Ungrouped" bucket. */
  groupId: string | null;
  name: string;
  weight: number | null;
  earned: number;
  possible: number;
  /** null when nothing in the group has been marked yet. */
  percent: number | null;
  /** Activity ids this group's drop rules left out of its total. */
  dropped?: string[];
}

export interface CourseGrade {
  /** 0-100, null when nothing counted has been marked. */
  percent: number | null;
  /** From the course grade scale, else the school default. */
  letter: string | null;
  groups: GroupScore[];
  /** Every activity id left out by the groups' drop rules. */
  dropped?: string[];
}

export interface PortalSubmissionState {
  status: SubmissionStatus;
  score: number | null;
  excused: boolean;
  attemptCount: number;
  submittedAt: string | null;
  feedback: string | null;
}

export interface PortalGradeActivity {
  id: string;
  courseId: string;
  assignmentGroupId: string | null;
  kind: WorkKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "draft" | "published" | "closed";
  publishedAt: string | null;
  allowFile: boolean;
  allowText: boolean;
  maxAttempts: number;
  /** null when the student has not started it. */
  submission: PortalSubmissionState | null;
  groupName: string | null;
  /** Left out of the total by its group's drop rule. */
  dropped?: boolean;
}

/** GET /portal/me/courses/:courseId/grades */
export interface PortalCourseGrades {
  grade: CourseGrade;
  groups: AssignmentGroup[];
  activities: PortalGradeActivity[];
}

/** Grade colour bands: >=90 green, >=80 teal, >=70 amber, else red. */
export function gradeColor(percent: number | null | undefined): string | null {
  if (percent === null || percent === undefined) return null;
  if (percent >= 90) return "#16a34a";
  if (percent >= 80) return "#0d9488";
  if (percent >= 70) return "#d97706";
  return "#dc2626";
}

/** "92.5%", or null when there is no percent to show. */
export function percentLabel(p: number | null | undefined): string | null {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  return `${formatScore(p)}%`;
}

/** Mean of the non-null percents, or null when there are none. */
export function averagePercent(
  percents: (number | null | undefined)[],
): number | null {
  const marked = percents.filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p),
  );
  if (marked.length === 0) return null;
  return marked.reduce((sum, p) => sum + p, 0) / marked.length;
}

export type ActivityGradeState =
  | { kind: "excused" }
  | { kind: "graded"; score: number }
  | { kind: "missing" }
  | { kind: "ungraded" };

/**
 * What a row in the grades list should say. Missing means it was due, it is
 * work that is handed in through the app, and nothing ever arrived.
 */
export function activityGradeState(a: PortalGradeActivity): ActivityGradeState {
  const sub = a.submission;
  if (sub?.excused) return { kind: "excused" };
  if (sub?.status === "graded" && sub.score !== null) {
    return { kind: "graded", score: sub.score };
  }
  const handedIn = !!sub && sub.status !== "draft";
  const pastDue = !!a.dueAt && new Date(a.dueAt).getTime() < Date.now();
  if (!handedIn && pastDue && a.kind !== "offline") return { kind: "missing" };
  return { kind: "ungraded" };
}

/** "drop lowest 2, drop highest 1", or null when the group drops nothing. */
export function dropRuleLabel(
  group: { dropLowest?: number | null; dropHighest?: number | null } | null | undefined,
): string | null {
  if (!group) return null;
  const parts = [
    group.dropLowest ? `drop lowest ${group.dropLowest}` : null,
    group.dropHighest ? `drop highest ${group.dropHighest}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
