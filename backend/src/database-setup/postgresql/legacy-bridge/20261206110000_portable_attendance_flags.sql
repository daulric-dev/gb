-- Attendance location flags are display metadata and do not participate in
-- database filtering, so store them as a JSON array rather than a PostgreSQL
-- scalar array.
--
-- Bridge fix: the original migration named the table
-- course.course_attendance_record (the Prisma model name); the table is
-- course.attendance_record.
ALTER TABLE course.attendance_record
    ALTER COLUMN location_flags DROP DEFAULT,
    ALTER COLUMN location_flags TYPE jsonb USING to_jsonb(location_flags),
    ALTER COLUMN location_flags SET DEFAULT '[]'::jsonb;
