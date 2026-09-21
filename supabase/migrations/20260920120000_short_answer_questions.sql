-- Short-answer quiz questions, alongside multiple choice and true/false.
--
-- The accepted answers reuse quiz_option: a short-answer question's options
-- are the wordings that count as right, all flagged is_correct. That keeps one
-- shape for "what makes this question correct" instead of a second table, and
-- the editor already knows how to manage a list of options.
--
-- Marking is automatic, like the other kinds: an answer counts when it matches
-- an accepted wording ignoring case and surrounding space. A quiz is marked the
-- moment it is handed in, so a question needing a human would leave the student
-- staring at a partial score - anything needing judgement belongs in an
-- assignment, which is marked by hand.
--
-- The accepted wordings must never reach the student's browser; the portal
-- selects options only for the kinds where the labels are the choices.

ALTER TYPE "grading"."question_kind" ADD VALUE IF NOT EXISTS 'short_answer';

ALTER TABLE "grading"."quiz_answer"
  ADD COLUMN IF NOT EXISTS "text_answer" "text";

COMMENT ON COLUMN "grading"."quiz_answer"."text_answer" IS
  'What the student typed for a short-answer question. NULL for the kinds answered by picking an option.';

-- Rescore with short answers included. Everything else is unchanged: weights,
-- scaling to the activity points and the write-through to the gradebook.
CREATE OR REPLACE FUNCTION "grading"."submit_quiz"(
  "p_submission_id" "uuid",
  "p_student_id" "uuid"
)
RETURNS TABLE ("score" numeric, "points" numeric)
LANGUAGE "plpgsql"
VOLATILE
SECURITY DEFINER
SET search_path = "grading", "public"
AS $$
DECLARE
  v_sub      record;
  v_activity record;
  v_earned   numeric := 0;
  v_possible numeric := 0;
  v_scaled   numeric;
BEGIN
  SELECT s.id, s.activity_id, s.student_id, s.status INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  -- The caller passes the student the guard resolved, never one from a client.
  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  IF v_sub.status <> 'draft' THEN
    RAISE EXCEPTION 'already_submitted' USING ERRCODE = 'P0022';
  END IF;

  SELECT a.id, a.kind, a.points, a.assessment_id, a.status, a.due_at
  INTO v_activity
  FROM grading.activity a WHERE a.id = v_sub.activity_id;

  IF v_activity.kind <> 'quiz' THEN
    RAISE EXCEPTION 'not_a_quiz' USING ERRCODE = 'P0023';
  END IF;

  IF v_activity.status <> 'published' THEN
    RAISE EXCEPTION 'activity_not_open' USING ERRCODE = 'P0024';
  END IF;

  SELECT
    COALESCE(SUM(q.points), 0),
    COALESCE(SUM(CASE WHEN correct.hit THEN q.points ELSE 0 END), 0)
  INTO v_possible, v_earned
  FROM grading.quiz_question q
  LEFT JOIN grading.quiz_answer ans
    ON ans.question_id = q.id AND ans.submission_id = p_submission_id
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN q.kind = 'short_answer' THEN EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.question_id = q.id
          AND o.is_correct
          AND ans.text_answer IS NOT NULL
          AND lower(btrim(ans.text_answer)) = lower(btrim(o.label))
      )
      ELSE EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.id = ans.option_id AND o.is_correct
      )
    END AS hit
  ) correct ON true
  WHERE q.activity_id = v_activity.id;

  -- Scale to the activity's points so the gradebook is in its own units.
  v_scaled := CASE
    WHEN v_possible > 0 THEN (v_earned / v_possible) * v_activity.points
    ELSE 0
  END;

  UPDATE grading.submission s
  SET status = 'graded',
      submitted_at = now(),
      graded_at = now(),
      score = v_scaled,
      updated_at = now()
  WHERE s.id = p_submission_id;

  -- Feed the gradebook so averages, weights and reports pick it up.
  IF v_activity.assessment_id IS NOT NULL THEN
    INSERT INTO grading.grade (assessment_id, student_id, score)
    VALUES (v_activity.assessment_id, p_student_id, v_scaled)
    ON CONFLICT (assessment_id, student_id)
    DO UPDATE SET score = EXCLUDED.score, updated_at = now();
  END IF;

  RETURN QUERY SELECT v_scaled, v_activity.points;
END;
$$;

REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") TO "service_role";
