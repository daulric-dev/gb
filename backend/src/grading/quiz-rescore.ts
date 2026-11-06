import type { Prisma } from '@/generated/prisma/client';

/**
 * Score a quiz's automatically marked submissions again from their stored
 * answers, against `points`, in the caller's transaction. Used when a quiz
 * goes from 0 points to more: every automatic score was 0 then, so there is
 * no fraction to rescale.
 *
 * Mirrors grading.submit_quiz (latest definition:
 * prisma/migrations/20261108110000_quiz_lockdown_presence): earned / possible
 * * points over the quiz's questions, 0 when the questions are worth nothing;
 * a choice question is right when its chosen option is correct, a short
 * answer when it equals a correct option's label ignoring case and
 * surrounding spaces. Keep the two in step.
 *
 * Only submissions submit_quiz scored and nobody marked since (`graded_by`
 * null, `score` set) and with no attempt in progress: starting a retake
 * clears the answers, so an open attempt's answers are not the ones its
 * score came from (its next submit scores it against the new points).
 * Returns how many submissions were updated.
 */
export async function rescoreQuizFromAnswers(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  activityId: string,
  points: number,
): Promise<number> {
  return tx.$executeRaw`
    update grading.submission s
    set score = case
          when t.possible > 0 then (t.earned / t.possible) * ${points}::numeric
          else 0
        end,
        updated_at = now()
    from (
      select s2.id,
             coalesce(sum(q.points), 0) as possible,
             coalesce(sum(case when correct.hit then q.points else 0 end), 0) as earned
      from grading.submission s2
      left join grading.quiz_question q on q.activity_id = s2.activity_id
      left join grading.quiz_answer ans
        on ans.question_id = q.id and ans.submission_id = s2.id
      left join lateral (
        select case
          when q.kind = 'short_answer' then exists (
            select 1
            from grading.quiz_option o
            where o.question_id = q.id
              and o.is_correct
              and ans.text_answer is not null
              and lower(btrim(ans.text_answer)) = lower(btrim(o.label))
          )
          else exists (
            select 1
            from grading.quiz_option o
            where o.id = ans.option_id and o.question_id = q.id and o.is_correct
          )
        end as hit
      ) correct on true
      where s2.activity_id = ${activityId}::uuid
        and s2.graded_by is null
        and s2.score is not null
        and s2.quiz_started_at is null
      group by s2.id
    ) t
    where s.id = t.id
  `;
}
