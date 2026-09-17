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
  createdAt: string;
}

export interface QuizOption {
  id: string;
  label: string;
  isCorrect?: boolean;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  kind: "multiple_choice" | "true_false";
  points: number;
  options: QuizOption[];
}

export interface ActivityDetail extends Activity {
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
  isSubjectSpecific: boolean;
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
    score: number | null;
    feedback: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
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
