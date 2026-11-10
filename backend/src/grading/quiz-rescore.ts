import { Prisma } from '@/generated/prisma/client';

/**
 * One question's credit (0 to 1) and whether it waits for the teacher, for
 * a `q` (grading.quiz_question) and its `ans` (grading.quiz_answer, or null).
 * Word for word the LATERAL in grading.submit_quiz (latest definition:
 * prisma/migrations/20261117100000_quiz_question_types); quiz-rescore.test.ts
 * checks they match, so change both together. questionCredit() in
 * quiz-questions.ts is the same rules in TypeScript.
 */
export const QUIZ_CREDIT = Prisma.sql`
    SELECT (CASE
      WHEN q.kind::text = 'short_answer' THEN CASE WHEN EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.question_id = q.id
          AND o.is_correct
          AND ans.text_answer IS NOT NULL
          AND lower(btrim(ans.text_answer)) = lower(btrim(o.label))
      ) THEN 1 ELSE 0 END
      WHEN q.kind::text IN ('multiple_choice', 'true_false') THEN CASE WHEN EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.id = ans.option_id AND o.question_id = q.id AND o.is_correct
      ) THEN 1 ELSE 0 END
      WHEN q.kind::text = 'numeric' THEN CASE
        WHEN ans.numeric_answer IS NOT NULL AND q.numeric_answer IS NOT NULL
          AND abs(ans.numeric_answer - q.numeric_answer) <= q.numeric_tolerance
        THEN 1 ELSE 0 END
      WHEN q.kind::text = 'multiple_select' THEN (
        SELECT CASE
          WHEN ans.option_ids IS NULL OR count(*) FILTER (WHERE o.is_correct) = 0 THEN 0
          WHEN q.partial_credit THEN greatest(0,
            (count(*) FILTER (WHERE o.is_correct AND o.id = ANY (ans.option_ids))
             - count(*) FILTER (WHERE NOT o.is_correct AND o.id = ANY (ans.option_ids)))::numeric
            / count(*) FILTER (WHERE o.is_correct))
          WHEN bool_and((o.id = ANY (ans.option_ids)) = o.is_correct) THEN 1
          ELSE 0 END
        FROM grading.quiz_option o
        WHERE o.question_id = q.id
      )
      WHEN q.kind::text = 'matching' THEN (
        SELECT CASE
          WHEN ans.matches IS NULL OR count(*) = 0 THEN 0
          WHEN q.partial_credit THEN
            (count(*) FILTER (WHERE ans.matches ->> o.id::text = o.match_label))::numeric / count(*)
          WHEN bool_and(coalesce(ans.matches ->> o.id::text = o.match_label, false)) THEN 1
          ELSE 0 END
        FROM grading.quiz_option o
        WHERE o.question_id = q.id
      )
      WHEN q.kind::text = 'ordering' THEN (
        SELECT CASE
          WHEN ans.option_ids IS NULL OR count(*) = 0 THEN 0
          WHEN q.partial_credit THEN
            (count(*) FILTER (WHERE array_position(ans.option_ids, o.id) = o.place))::numeric / count(*)
          WHEN bool_and(coalesce(array_position(ans.option_ids, o.id) = o.place, false)) THEN 1
          ELSE 0 END
        FROM (
          SELECT o2.id, row_number() OVER (ORDER BY o2.sort_order, o2.id)::integer AS place
          FROM grading.quiz_option o2
          WHERE o2.question_id = q.id
        ) o
      )
      WHEN q.kind::text IN ('essay', 'file_upload') THEN CASE
        WHEN ans.manual_points IS NULL OR q.points <= 0 THEN 0
        ELSE least(ans.manual_points, q.points) / q.points END
      ELSE 0
    END)::numeric AS credit,
    (q.kind::text IN ('essay', 'file_upload')
      AND ans.manual_points IS NULL
      AND (nullif(btrim(ans.text_answer), '') IS NOT NULL OR ans.file_id IS NOT NULL)) AS unmarked
`;

/**
 * The statement rescoreQuizFromAnswers runs. Exported for its test.
 *
 * The questions of each submission are its attempt's own
 * (grading.quiz_attempt_question) when it has them, else the quiz's - the
 * same set submit_quiz scores.
 */
export function rescoreSql(
  activityId: string,
  points: number,
  submissionId: string | null = null,
) {
  return Prisma.sql`
    update grading.submission s
    set score = case
          when t.possible > 0 then (t.earned / t.possible) * ${points}::numeric
          else 0
        end,
        raw_score = case
          when t.possible > 0 then (t.earned / t.possible) * ${points}::numeric
          else 0
        end,
        status = case when t.unmarked > 0 then 'submitted'::grading.submission_status
                      else 'graded'::grading.submission_status end,
        graded_at = case when t.unmarked > 0 then null else coalesce(s.graded_at, now()) end,
        updated_at = now()
    from (
      select s2.id,
             coalesce(sum(q.points), 0) as possible,
             coalesce(sum(q.points * correct.credit), 0) as earned,
             count(*) filter (where correct.unmarked) as unmarked
      from grading.submission s2
      left join grading.quiz_question q
        on q.id in (
             select aq.question_id from grading.quiz_attempt_question aq
             where aq.submission_id = s2.id
           )
        or (q.activity_id = s2.activity_id and not exists (
             select 1 from grading.quiz_attempt_question aq
             where aq.submission_id = s2.id
           ))
      left join grading.quiz_answer ans
        on ans.question_id = q.id and ans.submission_id = s2.id
      left join lateral (${QUIZ_CREDIT}) correct on true
      where s2.activity_id = ${activityId}::uuid
        and (${submissionId}::uuid is null or s2.id = ${submissionId}::uuid)
        and s2.graded_by is null
        and s2.score is not null
        and s2.quiz_started_at is null
      group by s2.id
    ) t
    where s.id = t.id
  `;
}

/**
 * Score a quiz's automatically marked submissions again from their stored
 * answers, against `points`, in the caller's transaction - all of them, or
 * the one `submissionId`. Used when a quiz goes from 0 points to more
 * (every automatic score was 0 then, so there is no fraction to rescale),
 * and after a teacher marks an essay or file question.
 *
 * Mirrors grading.submit_quiz: earned / possible * points over the
 * attempt's questions, 0 when they are worth nothing; a submission with an
 * answered essay or file question not yet marked stays `submitted` (needs
 * marking), otherwise it is `graded`. Writes raw_score (before any late
 * penalty) and score alike; the caller applies the late policy afterwards
 * (refreshLateness).
 *
 * Only submissions submit_quiz scored and nobody marked as a whole since
 * (`graded_by` null, `score` set) and with no attempt in progress: starting
 * a retake clears the answers, so an open attempt's answers are not the ones
 * its score came from. Returns how many submissions were updated.
 */
export async function rescoreQuizFromAnswers(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  activityId: string,
  points: number,
  submissionId: string | null = null,
): Promise<number> {
  return tx.$executeRaw(rescoreSql(activityId, points, submissionId));
}
