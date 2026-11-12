-- Attendance location flags are display metadata and do not participate in
-- database filtering, so store them as a JSON array rather than a PostgreSQL
-- scalar array.
ALTER TABLE course.course_attendance_record
    ALTER COLUMN location_flags DROP DEFAULT,
    ALTER COLUMN location_flags TYPE jsonb USING to_jsonb(location_flags),
    ALTER COLUMN location_flags SET DEFAULT '[]'::jsonb;
