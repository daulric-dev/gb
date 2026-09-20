-- How many times a student may sit a quiz.
--
-- Until now a quiz was one attempt, enforced by submit_quiz refusing anything
-- that was not still a draft. Teachers want to allow a retake - a practice
-- quiz worth sitting twice, or a second chance after a bad connection - so the
-- limit becomes a property of the activity.
--
-- max_attempts NULL means unlimited; 1 is the old behaviour and stays the
-- default, so nothing changes for work that already exists.
--
-- Attempts are counted rather than kept: a retake overwrites the previous
-- answers and the score, and the gradebook holds the latest attempt. Keeping
-- every attempt would need a submission row per attempt, and the one-row-per
-- student shape is what the marking screen, the file upload and the grade
-- write-through are all built on.

ALTER TABLE "grading"."activity"
  ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 1;

ALTER TABLE "grading"."activity"
  DROP CONSTRAINT IF EXISTS "activity_max_attempts_positive";

ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_max_attempts_positive"
  CHECK ("max_attempts" IS NULL OR "max_attempts" >= 1);

COMMENT ON COLUMN "grading"."activity"."max_attempts" IS
  'How many times a student may sit this. NULL means unlimited; 1 is a single attempt.';

ALTER TABLE "grading"."submission"
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN "grading"."submission"."attempt_count" IS
  'Attempts sat so far. Compared against activity.max_attempts before another is allowed.';

-- Work already handed in has been sat once.
UPDATE "grading"."submission"
SET "attempt_count" = 1
WHERE "status" <> 'draft' AND "attempt_count" = 0;

-- Scoring now counts the attempt and enforces the limit, instead of refusing
-- anything that is not a draft. Everything else is unchanged: short answers,
-- scaling to the activity points and the write-through to the gradebook.
--
-- Dropped first: the return type gains attempts_used, and Postgres will not
-- replace a function whose OUT parameters changed.
DROP FUNCTION IF EXISTS "grading"."submit_quiz"("uuid", "uuid");

CREATE OR REPLACE FUNCTION "grading"."submit_quiz"(
  "p_submission_id" "uuid",
  "p_student_id" "uuid"
)
RETURNS TABLE ("score" numeric, "points" numeric, "attempts_used" integer)
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
  v_attempts integer;
BEGIN
  SELECT s.id, s.activity_id, s.student_id, s.status, s.attempt_count
  INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  -- The caller passes the student the guard resolved, never one from a client.
  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  SELECT a.id, a.kind, a.points, a.assessment_id, a.status, a.due_at,
         a.max_attempts
  INTO v_activity
  FROM grading.activity a WHERE a.id = v_sub.activity_id;

  IF v_activity.kind <> 'quiz' THEN
    RAISE EXCEPTION 'not_a_quiz' USING ERRCODE = 'P0023';
  END IF;

  IF v_activity.status <> 'published' THEN
    RAISE EXCEPTION 'activity_not_open' USING ERRCODE = 'P0024';
  END IF;

  -- NULL max_attempts is unlimited; otherwise this attempt must fit.
  IF v_activity.max_attempts IS NOT NULL
     AND v_sub.attempt_count >= v_activity.max_attempts THEN
    RAISE EXCEPTION 'no_attempts_left' USING ERRCODE = 'P0022';
  END IF;

  v_attempts := v_sub.attempt_count + 1;

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
      attempt_count = v_attempts,
      updated_at = now()
  WHERE s.id = p_submission_id;

  -- Feed the gradebook so averages, weights and reports pick it up.
  IF v_activity.assessment_id IS NOT NULL THEN
    INSERT INTO grading.grade (assessment_id, student_id, score)
    VALUES (v_activity.assessment_id, p_student_id, v_scaled)
    ON CONFLICT (assessment_id, student_id)
    DO UPDATE SET score = EXCLUDED.score, updated_at = now();
  END IF;

  RETURN QUERY SELECT v_scaled, v_activity.points, v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") TO "service_role";
