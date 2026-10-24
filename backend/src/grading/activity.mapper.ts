/**
 * Row-to-wire mapping for activities and submissions, shared by the teacher
 * routes, the gradebook and the portal so every one of them sends the shapes
 * in frontend/lib/courses/types.ts and nothing more.
 */

import type { Prisma } from '@/generated/prisma/client';
import { roundScore } from './round';

export type ActivityKind = 'quiz' | 'assignment' | 'offline';
export type ActivityStatus = 'draft' | 'published' | 'closed';
export type SubmissionStatus = 'draft' | 'submitted' | 'graded';

export const ACTIVITY_SELECT = {
  id: true,
  course_id: true,
  assignment_group_id: true,
  kind: true,
  title: true,
  instructions: true,
  points: true,
  due_at: true,
  status: true,
  published_at: true,
  allow_file: true,
  allow_text: true,
  max_attempts: true,
  omit_from_final_grade: true,
  rubric_id: true,
  created_by: true,
  created_at: true,
} satisfies Prisma.activitySelect;

/** Soonest due first, undated work last, then in the order it was made. */
export const ACTIVITY_ORDER = [
  { due_at: { sort: 'asc', nulls: 'last' } },
  { created_at: 'asc' },
] satisfies Prisma.activityOrderByWithRelationInput[];

/**
 * A client's ISO date string as a Date to write. One without an offset is
 * read as UTC, as Postgres did with the old string writes.
 */
export function toTimestamp(value: string): Date;
export function toTimestamp(value: string | null): Date | null;
export function toTimestamp(value: string | null): Date | null {
  if (value === null) return null;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
  return new Date(local ? `${value}Z` : value);
}

/** A timestamp as the ISO string the API sends, whether a Date or already text. */
export function ts(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : (value as string);
}

/** The `Activity` contract. */
export function toActivity(a: any) {
  return {
    id: a.id as string,
    courseId: a.course_id as string,
    assignmentGroupId: (a.assignment_group_id as string | null) ?? null,
    kind: a.kind as ActivityKind,
    title: a.title as string,
    instructions: (a.instructions as string | null) ?? null,
    points: Number(a.points),
    dueAt: ts(a.due_at),
    status: a.status as ActivityStatus,
    publishedAt: ts(a.published_at),
    allowFile: !!a.allow_file,
    allowText: !!a.allow_text,
    // 0 rather than null over the wire: the editor shows a number, and
    // "unlimited" reads better as 0 than as an empty box.
    maxAttempts: (a.max_attempts as number | null) ?? 0,
    omitFromFinalGrade: !!a.omit_from_final_grade,
    rubricId: (a.rubric_id as string | null) ?? null,
    createdAt: ts(a.created_at) as string,
  };
}

export type ActivityDto = ReturnType<typeof toActivity>;

/**
 * The `PortalSubmissionState` contract.
 *
 * A score and feedback only reach the student once the work is graded: until
 * then a teacher may be halfway through marking, and a number that changes
 * under the student is worse than none.
 */
export function toPortalSubmission(s: any) {
  if (!s) return null;
  const graded = s.status === 'graded';
  return {
    status: s.status as SubmissionStatus,
    score:
      graded && s.score !== null && s.score !== undefined
        ? roundScore(Number(s.score))
        : null,
    excused: !!s.excused,
    attemptCount: (s.attempt_count as number | null) ?? 0,
    submittedAt: ts(s.submitted_at),
    feedback: graded ? ((s.feedback as string | null) ?? null) : null,
  };
}

/**
 * The `PortalCourseActivity` contract: the activity minus what only staff
 * need (whether it counts, when it was drafted), with the student's own
 * submission state.
 */
export function toPortalActivity(a: any, submission: any) {
  const full: Partial<ActivityDto> = toActivity(a);
  delete full.omitFromFinalGrade;
  delete full.createdAt;
  return {
    ...(full as Omit<ActivityDto, 'omitFromFinalGrade' | 'createdAt'>),
    submission: toPortalSubmission(submission),
  };
}
