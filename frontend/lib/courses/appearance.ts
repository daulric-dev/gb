import { courseColor, courseGradient } from "./format";

/**
 * Course banner presets. The keys are the backend's COURSE_BANNER_COLORS
 * (`backend/src/course/course-appearance.ts`, also a CHECK on
 * `course.course.banner_color`); the colours live only here and in the mobile
 * app's copy. Null is "Auto": the gradient derived from the course id.
 */
export const COURSE_BANNER_PRESETS = {
  indigo: { label: "Indigo", from: "#6366f1", to: "#4338ca" },
  violet: { label: "Violet", from: "#8b5cf6", to: "#6d28d9" },
  blue: { label: "Blue", from: "#3b82f6", to: "#1d4ed8" },
  sky: { label: "Sky", from: "#0ea5e9", to: "#0369a1" },
  teal: { label: "Teal", from: "#14b8a6", to: "#0f766e" },
  green: { label: "Green", from: "#22c55e", to: "#15803d" },
  amber: { label: "Amber", from: "#f59e0b", to: "#b45309" },
  orange: { label: "Orange", from: "#f97316", to: "#c2410c" },
  rose: { label: "Rose", from: "#f43f5e", to: "#be123c" },
  slate: { label: "Slate", from: "#64748b", to: "#334155" },
} as const;

export type CourseBannerColor = keyof typeof COURSE_BANNER_PRESETS;

export const COURSE_BANNER_COLORS = Object.keys(
  COURSE_BANNER_PRESETS,
) as CourseBannerColor[];

/** What a banner is drawn from; course list, detail and portal rows have it. */
export interface CourseAppearance {
  id: string;
  bannerColor?: string | null;
  bannerImageUrl?: string | null;
}

function preset(color: string | null | undefined) {
  return color && Object.prototype.hasOwnProperty.call(COURSE_BANNER_PRESETS, color)
    ? COURSE_BANNER_PRESETS[color as CourseBannerColor]
    : null;
}

/** The banner gradient: the chosen preset, else the id-derived one. */
export function bannerGradient(course: CourseAppearance): string {
  const p = preset(course.bannerColor);
  return p
    ? `linear-gradient(135deg, ${p.from}, ${p.to})`
    : courseGradient(course.id);
}

/** A single colour for a course (list accents, dots). */
export function bannerAccent(course: CourseAppearance): string {
  return preset(course.bannerColor)?.from ?? courseColor(course.id);
}
