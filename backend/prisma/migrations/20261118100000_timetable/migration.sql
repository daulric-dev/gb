-- Timetable and automatic attendance sessions (src/timetable).
--
-- A school gets a time zone, rooms (with an optional saved location used as
-- the check-in geofence), a bell schedule (named periods with times per
-- weekday), non-school days (closures), and timetable settings (weekly or an
-- N-day rotating cycle, lead time, check-in options). Courses get timetable
-- entries (a period on a weekday or cycle day, in a room, within dates),
-- per-occurrence overrides (cancel or move), and one occurrence row per
-- entry and date that the scheduler claims before opening a session, so a
-- session is opened at most once per occurrence on any number of replicas.

-- The school's IANA time zone. Existing schools get UTC; an admin sets the
-- real one on the timetable settings page. The API validates the name.
ALTER TABLE public.school
  ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE public.school
  ADD CONSTRAINT school_time_zone_length_check
    CHECK (char_length(time_zone) BETWEEN 1 AND 64);

CREATE TABLE public.timetable_setting (
  school_id uuid NOT NULL,
  cycle_length smallint,
  cycle_start_date date,
  school_days smallint[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::smallint[],
  auto_sessions boolean NOT NULL DEFAULT true,
  lead_minutes smallint NOT NULL DEFAULT 0,
  late_after_minutes smallint,
  require_code boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT timetable_setting_pkey PRIMARY KEY (school_id),
  CONSTRAINT timetable_setting_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT timetable_setting_cycle_length_check
    CHECK (cycle_length IS NULL OR cycle_length BETWEEN 2 AND 20),
  CONSTRAINT timetable_setting_cycle_start_check
    CHECK (cycle_length IS NULL OR cycle_start_date IS NOT NULL),
  CONSTRAINT timetable_setting_school_days_check
    CHECK (school_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT timetable_setting_lead_minutes_check
    CHECK (lead_minutes BETWEEN 0 AND 30),
  CONSTRAINT timetable_setting_late_after_check
    CHECK (late_after_minutes IS NULL OR late_after_minutes BETWEEN 0 AND 240)
);

CREATE TABLE public.room (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  name text NOT NULL,
  latitude double precision,
  longitude double precision,
  radius_m integer,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT room_pkey PRIMARY KEY (id),
  CONSTRAINT room_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT room_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT room_location_check CHECK (
    (latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL) = (radius_m IS NULL)
  ),
  CONSTRAINT room_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT room_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT room_radius_check CHECK (radius_m IS NULL OR radius_m BETWEEN 10 AND 1000)
);
CREATE UNIQUE INDEX room_school_name_key ON public.room USING btree (school_id, name);

CREATE TABLE public.bell_period (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  name text NOT NULL,
  position smallint NOT NULL DEFAULT 0,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bell_period_pkey PRIMARY KEY (id),
  CONSTRAINT bell_period_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT bell_period_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX bell_period_school_name_key ON public.bell_period USING btree (school_id, name);

-- A period's times on one weekday (ISO 1 = Monday .. 7 = Sunday), in minutes
-- after local midnight. No row: the period does not run that weekday.
CREATE TABLE public.bell_period_time (
  period_id uuid NOT NULL,
  weekday smallint NOT NULL,
  start_minute smallint NOT NULL,
  end_minute smallint NOT NULL,
  CONSTRAINT bell_period_time_pkey PRIMARY KEY (period_id, weekday),
  CONSTRAINT bell_period_time_period_id_fkey
    FOREIGN KEY (period_id) REFERENCES public.bell_period(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT bell_period_time_weekday_check CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT bell_period_time_range_check
    CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute)
);

-- Non-school days (holidays, closures), inclusive. Nothing is scheduled on
-- them and a rotating cycle does not advance over them.
CREATE TABLE public.school_closure (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT school_closure_pkey PRIMARY KEY (id),
  CONSTRAINT school_closure_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT school_closure_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT school_closure_range_check CHECK (end_date >= start_date)
);
CREATE INDEX idx_school_closure_school_start
  ON public.school_closure USING btree (school_id, start_date);

CREATE TABLE course.timetable_entry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  period_id uuid NOT NULL,
  room_id uuid,
  weekday smallint,
  cycle_day smallint,
  valid_from date,
  valid_to date,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT timetable_entry_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_entry_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT timetable_entry_period_id_fkey
    FOREIGN KEY (period_id) REFERENCES public.bell_period(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT timetable_entry_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES public.room(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT timetable_entry_day_check CHECK ((weekday IS NULL) <> (cycle_day IS NULL)),
  CONSTRAINT timetable_entry_weekday_check CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  CONSTRAINT timetable_entry_cycle_day_check CHECK (cycle_day IS NULL OR cycle_day BETWEEN 1 AND 20),
  CONSTRAINT timetable_entry_valid_check
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_timetable_entry_course ON course.timetable_entry USING btree (course_id);
CREATE INDEX idx_timetable_entry_period ON course.timetable_entry USING btree (period_id);
CREATE INDEX idx_timetable_entry_room ON course.timetable_entry USING btree (room_id);

-- One change to one occurrence (the entry on its scheduled date).
CREATE TABLE course.timetable_override (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  occurs_on date NOT NULL,
  kind text NOT NULL,
  moved_date date,
  moved_start_minute smallint,
  moved_end_minute smallint,
  moved_room_id uuid,
  note text,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT timetable_override_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_override_entry_id_fkey
    FOREIGN KEY (entry_id) REFERENCES course.timetable_entry(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT timetable_override_moved_room_id_fkey
    FOREIGN KEY (moved_room_id) REFERENCES public.room(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT timetable_override_kind_check CHECK (kind IN ('cancel', 'move')),
  CONSTRAINT timetable_override_move_check CHECK (
    kind <> 'move' OR (
      moved_date IS NOT NULL AND moved_start_minute IS NOT NULL
      AND moved_end_minute IS NOT NULL
      AND moved_start_minute >= 0 AND moved_end_minute <= 1440
      AND moved_end_minute > moved_start_minute
    )
  ),
  CONSTRAINT timetable_override_note_check CHECK (note IS NULL OR char_length(note) <= 200)
);
CREATE UNIQUE INDEX timetable_override_entry_date_key
  ON course.timetable_override USING btree (entry_id, occurs_on);
CREATE INDEX idx_timetable_override_moved_room
  ON course.timetable_override USING btree (moved_room_id);

-- The scheduler's claim on one occurrence (entry + original date): inserted
-- before the session opens, so it is opened once. session_id goes null if
-- staff delete the session; the row stays, so it is not reopened.
CREATE TABLE course.timetable_occurrence (
  entry_id uuid NOT NULL,
  occurs_on date NOT NULL,
  session_id uuid,
  status text NOT NULL,
  reason text,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT timetable_occurrence_pkey PRIMARY KEY (entry_id, occurs_on),
  CONSTRAINT timetable_occurrence_entry_id_fkey
    FOREIGN KEY (entry_id) REFERENCES course.timetable_entry(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT timetable_occurrence_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES course.attendance_session(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT timetable_occurrence_status_check CHECK (status IN ('opened', 'skipped'))
);
CREATE INDEX idx_timetable_occurrence_session
  ON course.timetable_occurrence USING btree (session_id);
