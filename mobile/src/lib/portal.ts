/** Shapes returned by the /portal/me endpoints. Mirrors the web portal types. */

import { formatScore } from "./format-number";
import type { CourseGrade } from "@/lib/grades";

export interface PortalMe {
  id: string;
  firstName: string | null;
  lastName: string | null;
  school: { id: string; name: string | null; type: string | null } | null;
}

/** GET /portal/me/courses - a course the student is enrolled in. */
export interface PortalCourseCard {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: "draft" | "published" | "archived";
  termId: string | null;
  teachers: { firstName: string | null; lastName: string | null }[];
  grade: CourseGrade | null;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function teacherNames(teachers: PortalCourseCard["teachers"]) {
  const names = teachers
    .map((t) => [t.firstName, t.lastName].filter(Boolean).join(" "))
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return `${formatScore(value)}%`;
}
