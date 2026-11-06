-- Live teacher position: staff may move an open session's point while it
-- runs. location_updated_at is when the point was last set (at open, or by
-- PATCH .../sessions/:id/location); null for sessions without a location.
ALTER TABLE course.attendance_session
  ADD COLUMN location_updated_at timestamp(6) with time zone;

UPDATE course.attendance_session
   SET location_updated_at = opened_at
 WHERE latitude IS NOT NULL;

-- What each location check-in reported, for staff review. Coordinates and
-- accuracy are only kept for sessions with a location check. location_flags
-- lists suspicious-reading markers (exact_point, duplicate_coords,
-- zero_accuracy, low_precision); they are recorded, never used to refuse.
ALTER TABLE course.attendance_record
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN accuracy_m double precision,
  ADD COLUMN location_flags text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT attendance_record_location_complete
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT attendance_record_accuracy_nonnegative
    CHECK (accuracy_m IS NULL OR accuracy_m >= 0);
