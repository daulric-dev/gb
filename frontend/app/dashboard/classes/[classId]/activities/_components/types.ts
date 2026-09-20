export type ActivityKind = "quiz" | "assignment";
export type ActivityStatus = "draft" | "published" | "closed";

export interface Activity {
  id: string;
  classId: string;
  subjectId: string;
  termId: string;
  gradingGroupId: string | null;
  assessmentId: string | null;
  kind: ActivityKind;
  title: string;
  instructions: string | null;
  points: number;
  dueAt: string | null;
  status: ActivityStatus;
  allowFile: boolean;
  allowText: boolean;
  /** How many times a quiz may be sat. 0 means unlimited. */
  maxAttempts: number;
  createdAt: string;
}

export interface QuizOption {
  id: string;
  label: string;
  isCorrect?: boolean;
}

export type QuestionKind = "multiple_choice" | "true_false" | "short_answer";

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  short_answer: "Short answer",
};

export interface QuizQuestion {
  id: string;
  prompt: string;
  kind: QuestionKind;
  points: number;
  options: QuizOption[];
}

export interface ActivityDetail extends Activity {
  /** True when the gradebook is ignoring this; only meaningful once published. */
  isExcluded: boolean;
  questions: QuizQuestion[];
}

export interface GradingGroup {
  id: string;
  name: string;
  weight: number;
  sortOrder: number;
  isExam: boolean;
}

export interface Scheme {
  groups: GradingGroup[];
  isClassSpecific: boolean;
  totalWeight: number;
}

export interface SubmissionRow {
  studentId: string;
  name: string;
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

export function formatDue(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};
