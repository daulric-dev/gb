/**
 * Course banner presets, the mobile copy of `frontend/lib/courses/appearance.ts`.
 * The keys are the backend's COURSE_BANNER_COLORS; null (or an unknown key)
 * is "Auto", a gradient derived from the course id exactly as the web app
 * derives it, so a course looks the same on both.
 */
export const COURSE_BANNER_PRESETS = {
  indigo: { from: "#6366f1", to: "#4338ca" },
  violet: { from: "#8b5cf6", to: "#6d28d9" },
  blue: { from: "#3b82f6", to: "#1d4ed8" },
  sky: { from: "#0ea5e9", to: "#0369a1" },
  teal: { from: "#14b8a6", to: "#0f766e" },
  green: { from: "#22c55e", to: "#15803d" },
  amber: { from: "#f59e0b", to: "#b45309" },
  orange: { from: "#f97316", to: "#c2410c" },
  rose: { from: "#f43f5e", to: "#be123c" },
  slate: { from: "#64748b", to: "#334155" },
} as const;

export type CourseBannerColor = keyof typeof COURSE_BANNER_PRESETS;

/** What a banner is drawn from; course and portal card rows carry it. */
export interface CourseAppearance {
  id: string;
  bannerColor?: string | null;
  bannerImageUrl?: string | null;
}

function courseHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** The two gradient stops (top-left to bottom-right) for a course banner. */
export function bannerStops(course: CourseAppearance): {
  from: string;
  to: string;
} {
  const color = course.bannerColor;
  if (color && Object.prototype.hasOwnProperty.call(COURSE_BANNER_PRESETS, color)) {
    return COURSE_BANNER_PRESETS[color as CourseBannerColor];
  }
  const hue = courseHue(course.id);
  return {
    from: `hsl(${hue}, 62%, 48%)`,
    to: `hsl(${(hue + 40) % 360}, 62%, 42%)`,
  };
}
