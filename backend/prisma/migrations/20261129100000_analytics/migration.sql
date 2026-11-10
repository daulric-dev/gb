-- Analytics dashboard (src/analytics), behind the `analytics` feature.
--
-- analytics_setting: a school's at-risk rules (null switches a rule off).
-- analytics_course_summary / analytics_at_risk / analytics_refresh: the
-- cached aggregates the school views read, refreshed by the analytics sweep
-- under an advisory lock. Nothing here is a source of truth: deleting these
-- rows only means the next sweep recomputes them.

CREATE TABLE public.analytics_setting (
  school_id uuid NOT NULL,
  min_grade smallint DEFAULT 60,
  missing_count smallint DEFAULT 3,
  window_weeks smallint NOT NULL DEFAULT 4,
  min_attendance smallint DEFAULT 90,
  mastery_below_level smallint DEFAULT 2,
  updated_by uuid,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analytics_setting_pkey PRIMARY KEY (school_id),
  CONSTRAINT analytics_setting_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT analytics_setting_min_grade_check
    CHECK (min_grade IS NULL OR min_grade BETWEEN 1 AND 100),
  CONSTRAINT analytics_setting_missing_count_check
    CHECK (missing_count IS NULL OR missing_count BETWEEN 1 AND 50),
  CONSTRAINT analytics_setting_window_weeks_check CHECK (window_weeks BETWEEN 1 AND 26),
  CONSTRAINT analytics_setting_min_attendance_check
    CHECK (min_attendance IS NULL OR min_attendance BETWEEN 1 AND 100),
  CONSTRAINT analytics_setting_mastery_level_check
    CHECK (mastery_below_level IS NULL OR mastery_below_level BETWEEN 2 AND 10)
);

CREATE TABLE public.analytics_course_summary (
  course_id uuid NOT NULL,
  school_id uuid NOT NULL,
  students integer NOT NULL,
  graded_students integer NOT NULL,
  grade_sum double precision NOT NULL,
  on_time integer NOT NULL,
  late integer NOT NULL,
  missing integer NOT NULL,
  excused integer NOT NULL,
  attendance_counted integer NOT NULL,
  attendance_attended integer NOT NULL,
  at_risk integer NOT NULL,
  computed_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analytics_course_summary_pkey PRIMARY KEY (course_id),
  CONSTRAINT analytics_course_summary_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT analytics_course_summary_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT analytics_course_summary_counts_check CHECK (
    students >= 0 AND graded_students >= 0 AND on_time >= 0 AND late >= 0
    AND missing >= 0 AND excused >= 0 AND attendance_counted >= 0
    AND attendance_attended >= 0 AND at_risk >= 0
  )
);
CREATE INDEX analytics_course_summary_school_id_idx
  ON public.analytics_course_summary USING btree (school_id);

CREATE TABLE public.analytics_at_risk (
  course_id uuid NOT NULL,
  student_id uuid NOT NULL,
  school_id uuid NOT NULL,
  grade double precision,
  missing integer NOT NULL,
  attendance_rate double precision,
  mastery_score double precision,
  reasons jsonb NOT NULL,
  computed_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analytics_at_risk_pkey PRIMARY KEY (course_id, student_id),
  CONSTRAINT analytics_at_risk_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT analytics_at_risk_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT analytics_at_risk_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX analytics_at_risk_school_id_idx ON public.analytics_at_risk USING btree (school_id);
CREATE INDEX analytics_at_risk_student_id_idx ON public.analytics_at_risk USING btree (student_id);

CREATE TABLE public.analytics_refresh (
  school_id uuid NOT NULL,
  refreshed_at timestamp(6) with time zone NOT NULL,
  courses integer NOT NULL,
  duration_ms integer NOT NULL,
  CONSTRAINT analytics_refresh_pkey PRIMARY KEY (school_id),
  CONSTRAINT analytics_refresh_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

-- The new permission. The catalog row is inserted here so it exists as soon
-- as the migration runs (the boot-time sync would add it too).
INSERT INTO public.permission_catalog (id, resource, action, key, description, created_at)
VALUES
  (gen_random_uuid(), 'analytics', 'read', 'analytics:read',
   'View school analytics (roll-ups per course and teacher) and students at risk in any course', now())
ON CONFLICT (resource, action) DO UPDATE
  SET key = EXCLUDED.key, description = EXCLUDED.description;

-- No automatic grants: analytics:read is its own permission. Admins hold it
-- (they hold every key); any other role gets it only when a school grants it
-- on the Roles page.
