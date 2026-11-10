-- Mastery / standards-based grading (src/mastery), behind the `mastery`
-- feature. Sits alongside the points gradebook: no existing table or column
-- changes, and nothing here affects a score, course total or letter.
--
-- A school has a proficiency scale (mastery_setting; defaults when there is
-- no row), outcome sets with nested outcomes, and courses can have their own
-- outcomes. Outcomes are aligned to whole activities, rubric rows or quiz
-- questions; every marked submission produces evidence per aligned outcome
-- (outcome_evidence), worked out again by the API whenever marks change.
-- An outcome with evidence cannot be deleted (evidence -> outcome is NO
-- ACTION); it is archived instead. Deleting a course or school still takes
-- everything with it (both sides cascade in the same statement).

CREATE TABLE grading.mastery_setting (
  school_id uuid NOT NULL,
  levels jsonb NOT NULL DEFAULT '["Beginning", "Developing", "Proficient", "Exceeding"]'::jsonb,
  mastery_threshold smallint NOT NULL DEFAULT 3,
  calculation text NOT NULL DEFAULT 'decaying_average',
  decay_weight numeric(3, 2) NOT NULL DEFAULT 0.65,
  min_evidence smallint NOT NULL DEFAULT 1,
  score_bands jsonb NOT NULL DEFAULT '[{"minPercent": 0, "level": 1}, {"minPercent": 50, "level": 2}, {"minPercent": 70, "level": 3}, {"minPercent": 90, "level": 4}]'::jsonb,
  report_card_section boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mastery_setting_pkey PRIMARY KEY (school_id),
  CONSTRAINT mastery_setting_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT mastery_setting_levels_check
    CHECK (jsonb_typeof(levels) = 'array' AND jsonb_array_length(levels) BETWEEN 2 AND 10),
  CONSTRAINT mastery_setting_threshold_check
    CHECK (mastery_threshold BETWEEN 1 AND 10),
  CONSTRAINT mastery_setting_calculation_check
    CHECK (calculation IN ('most_recent', 'highest', 'mean', 'decaying_average')),
  CONSTRAINT mastery_setting_decay_weight_check
    CHECK (decay_weight > 0 AND decay_weight < 1),
  CONSTRAINT mastery_setting_min_evidence_check
    CHECK (min_evidence BETWEEN 1 AND 20),
  CONSTRAINT mastery_setting_score_bands_check
    CHECK (jsonb_typeof(score_bands) = 'array')
);

CREATE TABLE grading.outcome_set (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  source text,
  archived_at timestamp(6) with time zone,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT outcome_set_pkey PRIMARY KEY (id),
  CONSTRAINT outcome_set_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX outcome_set_school_title_key
  ON grading.outcome_set USING btree (school_id, title);

CREATE TABLE grading.outcome (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  set_id uuid,
  course_id uuid,
  parent_id uuid,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  subject text,
  grade_level text,
  position integer NOT NULL DEFAULT 0,
  archived_at timestamp(6) with time zone,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT outcome_pkey PRIMARY KEY (id),
  CONSTRAINT outcome_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_set_id_fkey
    FOREIGN KEY (set_id) REFERENCES grading.outcome_set(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES grading.outcome(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  -- A school set's outcome or a course's own, never both or neither.
  CONSTRAINT outcome_owner_check CHECK ((set_id IS NULL) <> (course_id IS NULL)),
  CONSTRAINT outcome_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  CONSTRAINT outcome_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  CONSTRAINT outcome_parent_self_check CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX outcome_set_code_key ON grading.outcome USING btree (set_id, code);
CREATE UNIQUE INDEX outcome_course_code_key ON grading.outcome USING btree (course_id, code);
CREATE INDEX idx_outcome_school ON grading.outcome USING btree (school_id);
CREATE INDEX idx_outcome_parent ON grading.outcome USING btree (parent_id);

CREATE TABLE grading.outcome_alignment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  outcome_id uuid NOT NULL,
  course_id uuid NOT NULL,
  activity_id uuid,
  criterion_id uuid,
  question_id uuid,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT outcome_alignment_pkey PRIMARY KEY (id),
  CONSTRAINT outcome_alignment_outcome_id_fkey
    FOREIGN KEY (outcome_id) REFERENCES grading.outcome(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_alignment_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_alignment_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES grading.activity(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_alignment_criterion_id_fkey
    FOREIGN KEY (criterion_id) REFERENCES grading.rubric_criterion(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_alignment_question_id_fkey
    FOREIGN KEY (question_id) REFERENCES grading.quiz_question(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_alignment_target_check
    CHECK (num_nonnulls(activity_id, criterion_id, question_id) = 1)
);
CREATE UNIQUE INDEX outcome_alignment_activity_key
  ON grading.outcome_alignment USING btree (outcome_id, activity_id);
CREATE UNIQUE INDEX outcome_alignment_criterion_key
  ON grading.outcome_alignment USING btree (outcome_id, criterion_id);
CREATE UNIQUE INDEX outcome_alignment_question_key
  ON grading.outcome_alignment USING btree (outcome_id, question_id);
CREATE INDEX idx_outcome_alignment_course ON grading.outcome_alignment USING btree (course_id);
CREATE INDEX idx_outcome_alignment_activity ON grading.outcome_alignment USING btree (activity_id);
CREATE INDEX idx_outcome_alignment_criterion ON grading.outcome_alignment USING btree (criterion_id);
CREATE INDEX idx_outcome_alignment_question ON grading.outcome_alignment USING btree (question_id);

CREATE TABLE grading.outcome_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  outcome_id uuid NOT NULL,
  alignment_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  student_id uuid NOT NULL,
  course_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  source text NOT NULL,
  ratio double precision NOT NULL,
  rating_rank smallint,
  rating_count smallint,
  assessed_at timestamp(6) with time zone NOT NULL,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT outcome_evidence_pkey PRIMARY KEY (id),
  -- NO ACTION: an outcome with evidence cannot be deleted on its own.
  CONSTRAINT outcome_evidence_outcome_id_fkey
    FOREIGN KEY (outcome_id) REFERENCES grading.outcome(id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT outcome_evidence_alignment_id_fkey
    FOREIGN KEY (alignment_id) REFERENCES grading.outcome_alignment(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_evidence_submission_id_fkey
    FOREIGN KEY (submission_id) REFERENCES grading.submission(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_evidence_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_evidence_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_evidence_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES grading.activity(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outcome_evidence_source_check CHECK (source IN ('activity', 'rubric', 'question')),
  CONSTRAINT outcome_evidence_ratio_check CHECK (ratio >= 0 AND ratio <= 1),
  CONSTRAINT outcome_evidence_rating_check CHECK (
    (rating_rank IS NULL AND rating_count IS NULL)
    OR (rating_count >= 1 AND rating_rank >= 0 AND rating_rank < rating_count)
  )
);
CREATE UNIQUE INDEX outcome_evidence_alignment_submission_key
  ON grading.outcome_evidence USING btree (alignment_id, submission_id);
CREATE INDEX idx_outcome_evidence_student_outcome
  ON grading.outcome_evidence USING btree (student_id, outcome_id);
CREATE INDEX idx_outcome_evidence_course ON grading.outcome_evidence USING btree (course_id);
CREATE INDEX idx_outcome_evidence_outcome ON grading.outcome_evidence USING btree (outcome_id);
CREATE INDEX idx_outcome_evidence_submission ON grading.outcome_evidence USING btree (submission_id);
CREATE INDEX idx_outcome_evidence_activity ON grading.outcome_evidence USING btree (activity_id);
