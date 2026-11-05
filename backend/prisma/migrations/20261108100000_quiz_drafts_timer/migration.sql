ALTER TABLE grading.activity
  ADD COLUMN time_limit_minutes integer;

ALTER TABLE grading.activity
  ADD CONSTRAINT activity_time_limit_minutes_check
  CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 1440);

ALTER TABLE grading.submission
  ADD COLUMN quiz_started_at timestamptz,
  ADD COLUMN quiz_expires_at timestamptz;

ALTER TABLE grading.submission
  ADD CONSTRAINT submission_quiz_expiry_check
  CHECK (quiz_expires_at IS NULL OR quiz_started_at IS NOT NULL);

CREATE INDEX idx_submission_quiz_expires
  ON grading.submission (quiz_expires_at)
  WHERE quiz_expires_at IS NOT NULL;

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
         s.graded_by, s.quiz_started_at
  INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  IF v_sub.graded_by IS NOT NULL THEN
    RAISE EXCEPTION 'already_marked' USING ERRCODE = 'P0025';
  END IF;

  SELECT a.id, a.kind, a.points, a.status, a.max_attempts,
         a.time_limit_minutes
  INTO v_activity
  FROM grading.activity a WHERE a.id = v_sub.activity_id;

  IF v_activity.kind <> 'quiz' THEN
    RAISE EXCEPTION 'not_a_quiz' USING ERRCODE = 'P0023';
  END IF;

  IF v_activity.status <> 'published' AND v_sub.quiz_started_at IS NULL THEN
    RAISE EXCEPTION 'activity_not_open' USING ERRCODE = 'P0024';
  END IF;

  IF v_sub.quiz_started_at IS NULL THEN
    RAISE EXCEPTION 'quiz_attempt_not_started' USING ERRCODE = 'P0026';
  END IF;

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
        WHERE o.id = ans.option_id AND o.question_id = q.id AND o.is_correct
      )
    END AS hit
  ) correct ON true
  WHERE q.activity_id = v_activity.id;

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
      quiz_started_at = NULL,
      quiz_expires_at = NULL,
      updated_at = now()
  WHERE s.id = p_submission_id;

  RETURN QUERY SELECT v_scaled, v_activity.points, v_attempts;
END;
$$;
