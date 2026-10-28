/**
 * Quizzes and assignments, as a student sees them.
 *
 * Mirrors the web portal's shapes so both clients read the same responses from
 * /portal/me/activities. Correct answers are never part of these: the API does
 * not send them, and a short-answer question arrives with no options at all
 * because its options are the accepted wordings.
 */

import type { Rubric, RubricAssessment } from "@/lib/course";

export type WorkKind = "quiz" | "assignment" | "offline";
export type QuestionKind = "multiple_choice" | "true_false" | "short_answer";

export interface PortalWorkItem {
  id: string;
  kind: WorkKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "published" | "closed";
  allowFile: boolean;
  allowMultipleFiles: boolean;
  allowText: boolean;
  courseId: string | null;
  courseName: string | null;
  submission: {
    id: string;
    status: "draft" | "submitted" | "graded";
    score: number | null;
    submittedAt: string | null;
    gradedAt: string | null;
  } | null;
}

export interface PortalWorkDetail {
  id: string;
  kind: WorkKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "published" | "closed";
  allowFile: boolean;
  allowMultipleFiles: boolean;
  allowText: boolean;
  courseId?: string | null;
  courseName?: string | null;
  /** 0 means unlimited. */
  maxAttempts: number;
  attemptsUsed: number;
  questions: {
    id: string;
    prompt: string;
    kind: QuestionKind;
    points: number;
    options: { id: string; label: string }[];
  }[];
  /** Shown up front so the student knows how the work will be marked. */
  rubric?: Rubric | null;
  /** The levels picked, once marked with the rubric. */
  rubricAssessment?: RubricAssessment[] | null;
  submission: {
    id: string;
    status: "draft" | "submitted" | "graded";
    textBody: string | null;
    fileId: string | null;
    fileName: string | null;
    files?: { id: string; name: string; contentType: string }[];
    score: number | null;
    feedback: string | null;
    excused?: boolean;
    submittedAt: string | null;
    gradedAt: string | null;
    attemptCount: number;
  } | null;
}

export function dueLabel(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";

  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const formatted = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  if (days < 0) return `Was due ${formatted}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${formatted}`;
}

export function lateDays(
  dueAt: string | null,
  submittedAt: string | null,
): number | null {
  if (!dueAt || !submittedAt) return null;
  const due = new Date(dueAt).getTime();
  const submitted = new Date(submittedAt).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(submitted) || submitted <= due) {
    return null;
  }
  return Math.ceil((submitted - due) / 86_400_000);
}

/**
 * Work needing action sorts above work already handed in. Offline work is
 * handed in on paper, so it is never outstanding here.
 */
export function isOutstanding(item: PortalWorkItem) {
  if (item.kind === "offline") return false;
  return (
    item.status === "published" &&
    (!item.submission || item.submission.status === "draft")
  );
}

/**
 * Attempts left on a quiz, or null when the idea does not apply.
 * Infinity means unlimited.
 */
export function attemptsLeft(work: PortalWorkDetail): number | null {
  if (work.kind !== "quiz") return null;
  if (work.maxAttempts === 0) return Infinity;
  return Math.max(0, (work.maxAttempts || 1) - (work.attemptsUsed ?? 0));
}
