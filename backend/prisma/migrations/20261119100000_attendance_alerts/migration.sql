-- Attendance reports and alerts (src/attendance-alerts).
--
-- A student can have a form tutor (a staff member of the school, no foreign
-- key: the API checks membership whenever it uses it). A school sets alert
-- thresholds; an alert row is opened when a student falls below one and
-- resolved when they recover, and at most one alert per student and kind is
-- open at a time, so the same condition is not alerted again until it has
-- cleared. Parents can opt in to a new notice kind, attendance_alert.

ALTER TABLE student.student ADD COLUMN form_tutor_id uuid;
CREATE INDEX idx_student_form_tutor ON student.student USING btree (form_tutor_id);

CREATE TABLE public.attendance_alert_setting (
  school_id uuid NOT NULL,
  min_rate smallint,
  window_days smallint NOT NULL DEFAULT 28,
  min_sessions smallint NOT NULL DEFAULT 5,
  consecutive_absences smallint,
  notify_tutor boolean NOT NULL DEFAULT true,
  notify_admins boolean NOT NULL DEFAULT true,
  notify_parents boolean NOT NULL DEFAULT true,
  email_staff boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attendance_alert_setting_pkey PRIMARY KEY (school_id),
  CONSTRAINT attendance_alert_setting_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT attendance_alert_setting_min_rate_check
    CHECK (min_rate IS NULL OR min_rate BETWEEN 1 AND 100),
  CONSTRAINT attendance_alert_setting_window_check CHECK (window_days BETWEEN 7 AND 120),
  CONSTRAINT attendance_alert_setting_min_sessions_check CHECK (min_sessions BETWEEN 1 AND 100),
  CONSTRAINT attendance_alert_setting_consecutive_check
    CHECK (consecutive_absences IS NULL OR consecutive_absences BETWEEN 2 AND 30)
);

CREATE TABLE student.attendance_alert (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  kind text NOT NULL,
  value double precision NOT NULL,
  threshold double precision NOT NULL,
  window_days smallint,
  opened_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp(6) with time zone,
  acknowledged_at timestamp(6) with time zone,
  acknowledged_by uuid,
  CONSTRAINT attendance_alert_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_alert_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT attendance_alert_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT attendance_alert_kind_check CHECK (kind IN ('low_rate', 'consecutive_absences'))
);
-- One open alert per student and condition: re-alerting needs a recovery.
CREATE UNIQUE INDEX attendance_alert_open_key
  ON student.attendance_alert USING btree (student_id, kind) WHERE (resolved_at IS NULL);
CREATE INDEX idx_attendance_alert_school_opened
  ON student.attendance_alert USING btree (school_id, opened_at DESC);
CREATE INDEX idx_attendance_alert_student
  ON student.attendance_alert USING btree (student_id);

-- The new parent notice kind. Existing choices are kept (the new kind is
-- opt-in for parents who already picked kinds); new rows include it.
ALTER TABLE student.parent_notification_pref
  DROP CONSTRAINT parent_notification_pref_kinds_check;
ALTER TABLE student.parent_notification_pref
  ADD CONSTRAINT parent_notification_pref_kinds_check CHECK (
    kinds <@ ARRAY['missing_work', 'absence', 'new_grade', 'announcement', 'attendance_alert']::text[]
  );
ALTER TABLE student.parent_notification_pref
  ALTER COLUMN kinds SET DEFAULT ARRAY['missing_work', 'absence', 'new_grade', 'announcement', 'attendance_alert']::text[];
