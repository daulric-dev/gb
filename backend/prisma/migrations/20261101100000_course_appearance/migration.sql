-- Course appearance: the banner behind a course's title.
--
-- banner_color is one of a fixed set of gradient presets (the keys are
-- COURSE_BANNER_COLORS in src/course/course-appearance.ts; clients hold the
-- colours). Null is "auto": a gradient derived from the course id, as before.
-- banner_image_path is the cover image's key inside the `images` storage
-- area (`course-banners/<course id>-<random>.<ext>`); it wins over the colour.

ALTER TABLE course.course
    ADD COLUMN IF NOT EXISTS banner_color text,
    ADD COLUMN IF NOT EXISTS banner_image_path text;

ALTER TABLE course.course
    DROP CONSTRAINT IF EXISTS course_banner_color_check;

ALTER TABLE course.course
    ADD CONSTRAINT course_banner_color_check
    CHECK (banner_color IS NULL OR banner_color IN (
        'indigo', 'violet', 'blue', 'sky', 'teal',
        'green', 'amber', 'orange', 'rose', 'slate'
    ));
