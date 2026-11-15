-- Retention and erasure of personal data (src/retention, src/erasure).
--
-- 1. compliance.erasure_log: erasing a student record (DELETE /students/:id
--    and the school retention purge) is logged as kind 'student_record'.
-- 2. student.student.left_at: when the student stopped being active, kept by
--    a trigger, so a school's leaver retention period has a start date.
-- 3. public.school_retention_setting: a school's own retention periods for
--    leavers and closed academic years (off unless the school sets them).
-- 4. Indexes for the new purges (notifications, roster history, attendance
--    coordinates).
--
-- Audit-log tables are not touched.

-- 1. Erasure log kinds ------------------------------------------------------

ALTER TABLE compliance.erasure_log DROP CONSTRAINT erasure_log_kind_check;
ALTER TABLE compliance.erasure_log ADD CONSTRAINT erasure_log_kind_check CHECK ((kind = ANY (ARRAY[
  'account'::text, 'student'::text, 'school_membership'::text, 'file'::text, 'folder'::text,
  'chat_message'::text, 'discussion_topic'::text, 'discussion_reply'::text, 'course'::text,
  'attendance_session'::text, 'pastoral_note'::text, 'student_record'::text])));

-- 2. When a student left -----------------------------------------------------

ALTER TABLE student.student ADD COLUMN left_at timestamptz;

COMMENT ON COLUMN student.student.left_at IS
  'When is_active last became false (trigger student_set_left_at); null while active. Starts the school''s leaver retention period.';

-- Students already inactive: the clock starts now, never in the past, so
-- turning retention on cannot erase anyone without the 30-day notice.
UPDATE student.student SET left_at = now() WHERE is_active = false AND left_at IS NULL;

CREATE FUNCTION student.set_student_left_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM false THEN
    NEW.left_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM false THEN
    NEW.left_at := COALESCE(NEW.left_at, now());
  ELSE
    -- Still inactive: keep the original date.
    NEW.left_at := COALESCE(OLD.left_at, NEW.left_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_set_left_at
  BEFORE INSERT OR UPDATE OF is_active, left_at ON student.student
  FOR EACH ROW EXECUTE FUNCTION student.set_student_left_at();

CREATE INDEX idx_student_left_at ON student.student (school_id, left_at) WHERE left_at IS NOT NULL;

-- 3. Per-school retention settings --------------------------------------------

CREATE TABLE public.school_retention_setting (
  school_id                   uuid PRIMARY KEY REFERENCES public.school(id) ON DELETE CASCADE,
  -- Erase a student record this many days after the student became inactive; null = never.
  leaver_retention_days       integer,
  -- Erase a student record once the last academic year they were enrolled in
  -- ended this many years ago; null = never.
  closed_year_retention_years integer,
  -- An admin reviewed the due list and confirmed: purges only run after this.
  -- Cleared whenever a period changes.
  confirmed_at                timestamptz,
  confirmed_by                uuid,
  updated_by                  uuid,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_retention_setting_leaver_check
    CHECK (leaver_retention_days IS NULL OR leaver_retention_days BETWEEN 30 AND 3650),
  CONSTRAINT school_retention_setting_years_check
    CHECK (closed_year_retention_years IS NULL OR closed_year_retention_years BETWEEN 1 AND 25)
);

-- 4. Indexes for the purges -----------------------------------------------------

CREATE INDEX course_notification_created_at_idx ON course.course_notification (created_at);
CREATE INDEX file_notification_created_at_idx ON file_manager.notification (created_at);
-- Erasures delete the links naming a student or account by target alone.
CREATE INDEX roster_link_target_id_idx ON public.roster_link (target_id);
CREATE INDEX roster_link_disabled_at_idx ON public.roster_link (disabled_at) WHERE disabled_at IS NOT NULL;
CREATE INDEX attendance_record_coordinates_idx ON course.attendance_record (session_id)
  WHERE latitude IS NOT NULL OR longitude IS NOT NULL;
CREATE INDEX attendance_session_coordinates_idx ON course.attendance_session (closed_at)
  WHERE latitude IS NOT NULL OR longitude IS NOT NULL;
