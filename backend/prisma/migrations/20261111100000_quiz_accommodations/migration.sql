-- Per-student quiz accommodations. A student's time on a timed quiz is the
-- activity's time limit times time_multiplier, or plus extra_minutes; a
-- lockdown_exempt student takes a Lockdown quiz without it. The
-- activity-level row wins over the student's school-wide default.
CREATE TABLE grading.activity_accommodation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  student_id uuid NOT NULL,
  time_multiplier numeric(3,2),
  extra_minutes integer,
  lockdown_exempt boolean NOT NULL DEFAULT false,
  reason text,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT activity_accommodation_pkey PRIMARY KEY (id),
  CONSTRAINT activity_accommodation_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES grading.activity(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT activity_accommodation_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT activity_accommodation_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT activity_accommodation_time_multiplier_check
    CHECK (time_multiplier IS NULL OR time_multiplier IN (1.25, 1.5, 2)),
  CONSTRAINT activity_accommodation_extra_minutes_check
    CHECK (extra_minutes IS NULL OR extra_minutes BETWEEN 1 AND 600),
  CONSTRAINT activity_accommodation_one_time_kind_check
    CHECK (time_multiplier IS NULL OR extra_minutes IS NULL),
  CONSTRAINT activity_accommodation_not_empty_check
    CHECK (time_multiplier IS NOT NULL OR extra_minutes IS NOT NULL OR lockdown_exempt),
  CONSTRAINT activity_accommodation_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE UNIQUE INDEX activity_accommodation_activity_student_key
  ON grading.activity_accommodation USING btree (activity_id, student_id);
CREATE INDEX idx_activity_accommodation_student
  ON grading.activity_accommodation USING btree (student_id);
CREATE INDEX idx_activity_accommodation_created_by
  ON grading.activity_accommodation USING btree (created_by);

-- One school-wide default per student (the student row is school-scoped).
CREATE TABLE grading.student_accommodation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  time_multiplier numeric(3,2),
  extra_minutes integer,
  lockdown_exempt boolean NOT NULL DEFAULT false,
  reason text,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT student_accommodation_pkey PRIMARY KEY (id),
  CONSTRAINT student_accommodation_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT student_accommodation_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT student_accommodation_time_multiplier_check
    CHECK (time_multiplier IS NULL OR time_multiplier IN (1.25, 1.5, 2)),
  CONSTRAINT student_accommodation_extra_minutes_check
    CHECK (extra_minutes IS NULL OR extra_minutes BETWEEN 1 AND 600),
  CONSTRAINT student_accommodation_one_time_kind_check
    CHECK (time_multiplier IS NULL OR extra_minutes IS NULL),
  CONSTRAINT student_accommodation_not_empty_check
    CHECK (time_multiplier IS NOT NULL OR extra_minutes IS NOT NULL OR lockdown_exempt),
  CONSTRAINT student_accommodation_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE UNIQUE INDEX student_accommodation_student_key
  ON grading.student_accommodation USING btree (student_id);
CREATE INDEX idx_student_accommodation_created_by
  ON grading.student_accommodation USING btree (created_by);
