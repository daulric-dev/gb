export interface PortalWorkItem {
  id: string;
  kind: "quiz" | "assignment";
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "published" | "closed";
  allowFile: boolean;
  allowText: boolean;
  subject: { id: string; name: string | null; code: string | null } | null;
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
  kind: "quiz" | "assignment";
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: "published" | "closed";
  allowFile: boolean;
  allowText: boolean;
  /** 0 means unlimited. */
  maxAttempts: number;
  attemptsUsed: number;
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

/** Work needing action sorts above work already handed in. */
export function isOutstanding(item: PortalWorkItem) {
  return (
    item.status === "published" &&
    (!item.submission || item.submission.status === "draft")
  );
}
