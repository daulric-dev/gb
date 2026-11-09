-- More quiz question types, question banks and per-student shuffling.

-- New kinds. They are not used as enum literals anywhere below (the checks
-- compare kind as text), because a value added here cannot be used in the
-- same transaction.
ALTER TYPE grading.question_kind ADD VALUE IF NOT EXISTS 'essay';
ALTER TYPE grading.question_kind ADD VALUE IF NOT EXISTS 'multiple_select';
ALTER TYPE grading.question_kind ADD VALUE IF NOT EXISTS 'numeric';
ALTER TYPE grading.question_kind ADD VALUE IF NOT EXISTS 'matching';
ALTER TYPE grading.question_kind ADD VALUE IF NOT EXISTS 'ordering';
ALTER TYPE grading.question_kind ADD VALUE IF NOT EXISTS 'file_upload';

-- A course's reusable pool of questions. Its questions are quiz_question
-- rows with bank_id set instead of activity_id.
CREATE TABLE grading.question_bank (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  title text NOT NULL,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT question_bank_pkey PRIMARY KEY (id),
  CONSTRAINT question_bank_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT question_bank_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT question_bank_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200)
);
CREATE INDEX idx_question_bank_course ON grading.question_bank USING btree (course_id);
CREATE INDEX idx_question_bank_created_by ON grading.question_bank USING btree (created_by);

-- Per-type settings on a question.
--   numeric:          numeric_answer, numeric_tolerance (absolute, >= 0)
--   multiple_select, matching, ordering: partial_credit (else all or nothing)
--   essay:            rubric_id (optional, a guide for the marker)
--   file_upload:      file_types (extensions such as .pdf, or MIME types
--                     such as image/*; empty accepts anything), file_max_mb
ALTER TABLE grading.quiz_question
  ALTER COLUMN activity_id DROP NOT NULL,
  ADD COLUMN bank_id uuid,
  ADD COLUMN numeric_answer numeric,
  ADD COLUMN numeric_tolerance numeric NOT NULL DEFAULT 0,
  ADD COLUMN partial_credit boolean NOT NULL DEFAULT false,
  ADD COLUMN rubric_id uuid,
  ADD COLUMN file_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN file_max_mb integer,
  ADD CONSTRAINT quiz_question_bank_id_fkey
    FOREIGN KEY (bank_id) REFERENCES grading.question_bank(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT quiz_question_rubric_id_fkey
    FOREIGN KEY (rubric_id) REFERENCES grading.rubric(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT quiz_question_one_owner_check
    CHECK ((activity_id IS NULL) <> (bank_id IS NULL)),
  ADD CONSTRAINT quiz_question_numeric_check
    CHECK (kind::text <> 'numeric' OR numeric_answer IS NOT NULL),
  ADD CONSTRAINT quiz_question_tolerance_check
    CHECK (numeric_tolerance >= 0),
  ADD CONSTRAINT quiz_question_file_max_mb_check
    CHECK (file_max_mb IS NULL OR file_max_mb BETWEEN 1 AND 1000);
CREATE INDEX idx_quiz_question_bank ON grading.quiz_question USING btree (bank_id);
CREATE INDEX idx_quiz_question_rubric ON grading.quiz_question USING btree (rubric_id);

-- Matching: each option is a left-hand item, match_label its right-hand match.
-- Ordering: the options' sort_order is the right order.
ALTER TABLE grading.quiz_option
  ADD COLUMN match_label text,
  ADD CONSTRAINT quiz_option_match_label_check
    CHECK (match_label IS NULL OR char_length(match_label) <= 300);

-- Answers to the new kinds, and the teacher's mark on essay and file answers.
--   multiple_select: option_ids (the chosen options)
--   ordering:        option_ids (in the student's order)
--   matching:        matches, {"<option id>": "<chosen right-hand label>"}
--   numeric:         numeric_answer
--   essay:           text_answer
--   file_upload:     file_id (the student's own upload)
ALTER TABLE grading.quiz_answer
  ADD COLUMN option_ids uuid[],
  ADD COLUMN matches jsonb,
  ADD COLUMN numeric_answer numeric,
  ADD COLUMN file_id uuid,
  ADD COLUMN manual_points numeric,
  ADD COLUMN manual_feedback text,
  ADD COLUMN marked_by uuid,
  ADD COLUMN marked_at timestamp(6) with time zone,
  ADD CONSTRAINT quiz_answer_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES file_manager.file(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT quiz_answer_marked_by_fkey
    FOREIGN KEY (marked_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT quiz_answer_matches_object_check
    CHECK (matches IS NULL OR jsonb_typeof(matches) = 'object'),
  ADD CONSTRAINT quiz_answer_manual_points_check
    CHECK (manual_points IS NULL OR manual_points >= 0),
  ADD CONSTRAINT quiz_answer_manual_feedback_check
    CHECK (manual_feedback IS NULL OR char_length(manual_feedback) <= 2000);
CREATE INDEX idx_quiz_answer_file ON grading.quiz_answer USING btree (file_id);
CREATE INDEX idx_quiz_answer_marked_by ON grading.quiz_answer USING btree (marked_by);

-- Shuffle each student's question order and/or option order.
ALTER TABLE grading.activity
  ADD COLUMN shuffle_questions boolean NOT NULL DEFAULT false,
  ADD COLUMN shuffle_options boolean NOT NULL DEFAULT false;

-- A quiz draws draw_count random questions from a bank, per student.
CREATE TABLE grading.quiz_bank_draw (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  draw_count integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quiz_bank_draw_pkey PRIMARY KEY (id),
  CONSTRAINT quiz_bank_draw_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES grading.activity(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT quiz_bank_draw_bank_id_fkey
    FOREIGN KEY (bank_id) REFERENCES grading.question_bank(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT quiz_bank_draw_count_check CHECK (draw_count BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX quiz_bank_draw_activity_bank_key
  ON grading.quiz_bank_draw USING btree (activity_id, bank_id);
CREATE INDEX idx_quiz_bank_draw_bank ON grading.quiz_bank_draw USING btree (bank_id);

-- The questions one attempt was given, in the student's order, with the
-- order their options are shown in. Fixed when the attempt starts, so
-- resuming shows the same quiz and scoring (and later re-scoring) uses
-- exactly these questions. Kept after submitting; replaced by a retake.
CREATE TABLE grading.quiz_attempt_question (
  submission_id uuid NOT NULL,
  question_id uuid NOT NULL,
  "position" integer NOT NULL,
  option_order uuid[] NOT NULL DEFAULT '{}',
  CONSTRAINT quiz_attempt_question_pkey PRIMARY KEY (submission_id, question_id),
  CONSTRAINT quiz_attempt_question_submission_id_fkey
    FOREIGN KEY (submission_id) REFERENCES grading.submission(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT quiz_attempt_question_question_id_fkey
    FOREIGN KEY (question_id) REFERENCES grading.quiz_question(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX idx_quiz_attempt_question_question
  ON grading.quiz_attempt_question USING btree (question_id);

-- Scoring. Each question earns points × credit, credit from 0 to 1:
--   multiple choice, true/false: the chosen option is correct
--   short answer: equals an accepted wording, ignoring case and spaces
--   numeric: within the tolerance of the answer
--   multiple select: all or nothing (exactly the correct options), or with
--     partial credit (right picks - wrong picks) / correct options, at least 0
--   matching: every pair right, or with partial credit the share right
--   ordering: every item in place, or with partial credit the share in place
--   essay, file upload: the teacher's points / the question's points
-- The questions are the attempt's own (quiz_attempt_question) when it has
-- them, else the quiz's. An answered essay or file question the teacher has
-- not marked leaves the submission 'submitted' (needs marking), scored so
-- far; once all are marked it is 'graded'. raw_score is the mark before a
-- late penalty, which the API applies afterwards.
CREATE OR REPLACE FUNCTION grading.submit_quiz(p_submission_id uuid, p_student_id uuid) RETURNS TABLE(score numeric, points numeric, attempts_used integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'grading', 'public'
    AS $$
DECLARE
  v_sub      record;
  v_activity record;
  v_earned   numeric := 0;
  v_possible numeric := 0;
  v_unmarked integer := 0;
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
         a.time_limit_minutes, a.lockdown_browser
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
    COALESCE(SUM(q.points * correct.credit), 0),
    COUNT(*) FILTER (WHERE correct.unmarked)
  INTO v_possible, v_earned, v_unmarked
  FROM grading.quiz_question q
  LEFT JOIN grading.quiz_answer ans
    ON ans.question_id = q.id AND ans.submission_id = p_submission_id
  LEFT JOIN LATERAL (
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
  ) correct ON true
  WHERE q.id IN (
      SELECT aq.question_id FROM grading.quiz_attempt_question aq
      WHERE aq.submission_id = p_submission_id
    )
    OR (q.activity_id = v_activity.id AND NOT EXISTS (
      SELECT 1 FROM grading.quiz_attempt_question aq
      WHERE aq.submission_id = p_submission_id
    ));

  v_scaled := CASE
    WHEN v_possible > 0 THEN (v_earned / v_possible) * v_activity.points
    ELSE 0
  END;

  UPDATE grading.submission s
  SET status = CASE WHEN v_unmarked > 0 THEN 'submitted'::grading.submission_status
                    ELSE 'graded'::grading.submission_status END,
      submitted_at = now(),
      graded_at = CASE WHEN v_unmarked > 0 THEN NULL ELSE now() END,
      score = v_scaled,
      raw_score = v_scaled,
      attempt_started_at = v_sub.quiz_started_at,
      attempt_count = v_attempts,
      quiz_started_at = NULL,
      quiz_expires_at = NULL,
      is_away = false,
      updated_at = now()
  WHERE s.id = p_submission_id;

  RETURN QUERY SELECT v_scaled, v_activity.points, v_attempts;
END;
$$;
