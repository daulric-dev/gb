import type { Activity, SubmissionStatus } from "@/lib/courses/types";
import type { AccommodationSummary } from "@/lib/courses/accommodations";

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
  /** The student's own due date: their extension, else the activity's. */
  effectiveDueAt?: string | null;
  /** A later due date for this student only. */
  extension?: StudentExtension | null;
  /** A quiz accommodation (extra time, no Lockdown): this quiz's, else the default. */
  accommodation?: AccommodationSummary | null;
  /** The student's school-wide default, which applies without this quiz's own. */
  defaultAccommodation?: AccommodationSummary | null;
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
    quizStartedAt?: string | null;
    quizExpiresAt?: string | null;
    isActiveAttempt?: boolean;
    isAway?: boolean;
    awayReason?: string | null;
    tabSwitchCount?: number;
    lastAwayAt?: string | null;
  } | null;
}

/** A per-student due date (PUT /activities/:activityId/extensions/:studentId). */
export interface StudentExtension {
  dueAt: string;
  reason: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
