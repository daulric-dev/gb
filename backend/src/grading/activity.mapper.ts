/**
 * Row-to-wire mapping for activities and submissions, shared by the teacher
 * routes, the gradebook and the portal so every one of them sends the shapes
 * in frontend/lib/courses/types.ts and nothing more.
 */

export type ActivityKind = 'quiz' | 'assignment' | 'offline';
export type ActivityStatus = 'draft' | 'published' | 'closed';
export type SubmissionStatus = 'draft' | 'submitted' | 'graded';

export const ACTIVITY_COLUMNS =
  'id, course_id, assignment_group_id, kind, title, instructions, points, due_at, status, published_at, allow_file, allow_text, max_attempts, omit_from_final_grade, created_by, created_at';

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
    dueAt: (a.due_at as string | null) ?? null,
    status: a.status as ActivityStatus,
    publishedAt: (a.published_at as string | null) ?? null,
    allowFile: !!a.allow_file,
    allowText: !!a.allow_text,
    // 0 rather than null over the wire: the editor shows a number, and
    // "unlimited" reads better as 0 than as an empty box.
    maxAttempts: (a.max_attempts as number | null) ?? 0,
    omitFromFinalGrade: !!a.omit_from_final_grade,
    createdAt: a.created_at as string,
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
        ? Number(s.score)
        : null,
    excused: !!s.excused,
    attemptCount: (s.attempt_count as number | null) ?? 0,
    submittedAt: (s.submitted_at as string | null) ?? null,
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
