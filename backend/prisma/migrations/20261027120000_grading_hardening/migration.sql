-- grading.submit_quiz: refuse a retake once a teacher has marked the
-- submission by hand or through a gradebook import (graded_by is set).
-- Same body as 0_baseline otherwise; graded_by is only ever written by staff
-- marking, never by this function.

CREATE OR REPLACE FUNCTION grading.submit_quiz(p_submission_id uuid, p_student_id uuid) RETURNS TABLE(score numeric, points numeric, attempts_used integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'grading', 'public'
    AS $$
DECLARE
  v_sub      record;
  v_activity record;
  v_earned   numeric := 0;
  v_possible numeric := 0;
  v_scaled   numeric;
  v_attempts integer;
BEGIN
  SELECT s.id, s.activity_id, s.student_id, s.status, s.attempt_count,
         s.graded_by
  INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  -- The caller passes the student the guard resolved, never one from a client.
  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  -- A mark a teacher entered or imported is final: a retake must not
  -- overwrite it with an automatic score.
  IF v_sub.graded_by IS NOT NULL THEN
    RAISE EXCEPTION 'already_marked' USING ERRCODE = 'P0025';
  END IF;

  SELECT a.id, a.kind, a.points, a.status, a.max_attempts
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
      -- The option must belong to this question: a correct option id from
      -- some other question is not a right answer here.
      ELSE EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.id = ans.option_id AND o.question_id = q.id AND o.is_correct
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

  RETURN QUERY SELECT v_scaled, v_activity.points, v_attempts;
END;
$$;
