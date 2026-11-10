-- Announcement audiences (src/announcement). A school-wide announcement
-- (course_id IS NULL) is for staff only, as before, or for everyone in the
-- school: staff, students and parents. Further audiences (e.g. students,
-- parents) can be added later with ALTER TYPE ... ADD VALUE.
CREATE TYPE public.announcement_audience AS ENUM ('staff', 'everyone');

-- Every existing announcement keeps today's visibility (staff only).
ALTER TABLE public.announcement
  ADD COLUMN audience public.announcement_audience NOT NULL DEFAULT 'staff';

-- The student and parent portals list a school's 'everyone' posts newest first.
CREATE INDEX idx_announcement_school_audience_created
  ON public.announcement (school_id, audience, created_at DESC)
  WHERE course_id IS NULL;
