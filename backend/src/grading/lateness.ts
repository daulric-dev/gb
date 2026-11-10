import type { Prisma } from '@/generated/prisma/client';
import { effectiveDueAt } from './due-date';
import {
  applyLatePenalty,
  latePenaltyPercent,
  latePolicyOf,
  lateSeconds,
} from './late-policy';

type Tx = Pick<
  Prisma.TransactionClient,
  'activity' | 'submission' | 'activity_extension'
>;

/**
 * Work out lateness and the late penalty again for an activity's handed-in
 * submissions (or only `studentIds`'), in the caller's transaction, and
 * write them with the penalised score.
 *
 * Called after anything that changes them: a hand-in, a mark (teacher,
 * rubric, quiz scoring, question marking), a waiver, the activity's due date
 * or late policy, or a student's extension. A submission's score is
 * `raw_score` less the penalty (none when waived); one with no raw score
 * (an imported mark, or a mark from before late policies) keeps its score.
 *
 * Lateness is measured from the hand-in (`submitted_at`), or for a quiz
 * from when its attempt began (`attempt_started_at`), against the student's
 * effective due date - so an extension, which moves that date, removes the
 * lateness of anything handed in before it.
 */
export async function refreshLateness(
  tx: Tx,
  activityId: string,
  studentIds?: string[],
): Promise<void> {
  if (studentIds && studentIds.length === 0) return;
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: {
      kind: true,
      due_at: true,
      late_penalty_mode: true,
      late_penalty_value: true,
      late_penalty_cap: true,
    },
  });
  if (!activity) return;
  const policy = latePolicyOf(activity);
  const studentFilter = studentIds ? { student_id: { in: studentIds } } : {};

  const [submissions, extensions] = await Promise.all([
    tx.submission.findMany({
      where: { activity_id: activityId, ...studentFilter },
      select: {
        id: true,
        student_id: true,
        submitted_at: true,
        attempt_started_at: true,
        score: true,
        raw_score: true,
        late_seconds: true,
        late_penalty_percent: true,
        late_penalty_waived: true,
      },
    }),
    tx.activity_extension.findMany({
      where: { activity_id: activityId, ...studentFilter },
      select: { student_id: true, due_at: true },
    }),
  ]);
  const extensionOf = new Map(
    (extensions ?? []).map((e) => [e.student_id, e.due_at]),
  );

  for (const s of submissions ?? []) {
    const due = effectiveDueAt(activity.due_at, extensionOf.get(s.student_id));
    const reference =
      activity.kind === 'quiz'
        ? (s.attempt_started_at ?? s.submitted_at)
        : s.submitted_at;
    const late = lateSeconds(reference, due);
    const percent = latePenaltyPercent(policy, late);
    const raw = s.raw_score === null ? null : Number(s.raw_score);
    const score =
      raw === null
        ? s.score === null
          ? null
          : Number(s.score)
        : applyLatePenalty(raw, s.late_penalty_waived ? 0 : percent);

    const unchanged =
      s.late_seconds === late &&
      Number(s.late_penalty_percent) === percent &&
      (raw === null ||
        (s.score !== null && Number(s.score) === score));
    if (unchanged) continue;

    await tx.submission.update({
      where: { id: s.id },
      data: {
        late_seconds: late,
        late_penalty_percent: percent,
        ...(raw === null ? {} : { score }),
      },
    });
  }
}
