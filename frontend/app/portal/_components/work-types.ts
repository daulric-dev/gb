import type {
  ActivityKind,
  PortalCourseActivity,
  Rubric,
  RubricAssessment,
} from "@/lib/courses/types";

export interface PortalWorkItem {
  id: string;
  kind: ActivityKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "published" | "closed";
  allowFile: boolean;
  allowText: boolean;
  courseId: string | null;
  courseName: string | null;
  submission: {
    id: string;
    status: "draft" | "submitted" | "graded";
    score: number | null;
    excused?: boolean;
    submittedAt: string | null;
    gradedAt: string | null;
  } | null;
}

export interface PortalWorkDetail {
  id: string;
  kind: ActivityKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "published" | "closed";
  allowFile: boolean;
  allowText: boolean;
  courseId?: string | null;
  courseName?: string | null;
  /** 0 means unlimited. */
  maxAttempts: number;
  attemptsUsed: number;
  /** How the work is marked, shown before and after marking. */
  rubric?: Rubric | null;
  /** The levels this student was given; only once the mark is final. */
  rubricAssessment?: RubricAssessment[] | null;
  questions: {
    id: string;
    prompt: string;
    kind: "multiple_choice" | "true_false" | "short_answer";
    points: number;
    options: { id: string; label: string }[];
  }[];
  submission: {
    id: string;
    status: "draft" | "submitted" | "graded";
    textBody: string | null;
    fileId: string | null;
    fileName: string | null;
    score: number | null;
    excused?: boolean;
    feedback: string | null;
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

export function isOverdue(dueAt: string | null) {
  if (!dueAt) return false;
  const t = new Date(dueAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/**
 * Work needing action sorts above work already handed in. Offline work is
 * handed in on paper, so it never sits on the to-do list.
 */
export function isOutstanding(item: {
  kind: ActivityKind;
  status: string;
  submission: { status: string; excused?: boolean } | null;
}) {
  if (item.kind === "offline") return false;
  if (item.submission?.excused) return false;
  return (
    item.status === "published" &&
    (!item.submission || item.submission.status === "draft")
  );
}

/** Upcoming first by due date, undated last. */
export function byDueDate(
  a: { dueAt: string | null },
  b: { dueAt: string | null },
) {
  const ta = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
  const tb = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
  return ta - tb;
}

export type CourseActivityBucket = "upcoming" | "past" | "done";

/** Groups a course's assignments the way Canvas does. */
export function bucketActivity(a: PortalCourseActivity): CourseActivityBucket {
  const s = a.submission;
  if (s && (s.status !== "draft" || s.excused)) return "done";
  if (a.kind === "offline") return isOverdue(a.dueAt) ? "past" : "upcoming";
  if (a.status === "closed" || isOverdue(a.dueAt)) return "past";
  return "upcoming";
}
