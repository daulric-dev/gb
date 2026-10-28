import type { Activity, SubmissionStatus } from "@/lib/courses/types";

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

/** GET /activities/:activityId */
export interface ActivityDetail extends Activity {
  questions: QuizQuestion[];
}

/** One row of GET /activities/:activityId/submissions: every student in the course. */
export interface SubmissionRow {
  studentId: string;
  name: string;
  enrollmentStatus?: "active" | "dropped" | "completed";
  submission: {
    id: string;
    status: SubmissionStatus;
    textBody: string | null;
    fileId: string | null;
    fileName: string | null;
    files?: { id: string; name: string; contentType: string }[];
    score: number | null;
    feedback: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
    attemptCount: number;
    excused: boolean;
    excusedReason: string | null;
  } | null;
}
