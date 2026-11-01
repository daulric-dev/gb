/**
 * Gradient presets a course banner can use. Only the keys live here (they
 * validate `bannerColor` and match the CHECK on `course.course.banner_color`);
 * each client maps them to colours: `frontend/lib/courses/appearance.ts` and
 * `mobile/src/features/course/appearance.ts`. Null is "auto", a gradient
 * derived from the course id.
 */
export const COURSE_BANNER_COLORS = [
  'indigo',
  'violet',
  'blue',
  'sky',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'slate',
] as const;
export type CourseBannerColor = (typeof COURSE_BANNER_COLORS)[number];

/** Largest course cover image accepted. */
export const COURSE_BANNER_MAX_BYTES = 5 * 1024 * 1024;
