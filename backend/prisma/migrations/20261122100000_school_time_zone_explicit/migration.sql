-- The school's time zone must be chosen deliberately.
--
-- 20261118100000_timetable added public.school.time_zone as NOT NULL with
-- DEFAULT 'UTC', so every school silently ran its timetable in UTC and
-- automatic attendance sessions opened at the wrong local time until an
-- admin noticed. From here a school has no time zone (NULL) until an admin
-- sets one; while it is NULL the timetable scheduler skips the school, the
-- API refuses to switch automatic sessions on, and reports count UTC days and
-- say so (`timeZoneSet: false`).
--
-- Assumption: the timetable feature has not been released, so no school has
-- deliberately chosen UTC yet. Every 'UTC' value is the old default and is
-- cleared. A school that really is on UTC sets it again on the setup page.
ALTER TABLE public.school ALTER COLUMN time_zone DROP NOT NULL;
ALTER TABLE public.school ALTER COLUMN time_zone DROP DEFAULT;

UPDATE public.school SET time_zone = NULL WHERE time_zone = 'UTC';

-- school_time_zone_length_check (char_length BETWEEN 1 AND 64) stays: a CHECK
-- passes for NULL, so it still only constrains a zone that is set.
