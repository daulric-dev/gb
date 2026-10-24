import type {
  ActivityKind,
  ActivityStatus,
  CourseRole,
  CourseStatus,
} from "./types";

export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const COURSE_ROLE_LABEL: Record<CourseRole, string> = {
  admin: "Admin",
  teacher: "Teacher",
  ta: "TA",
};

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  quiz: "Quiz",
  assignment: "Assignment",
  offline: "Offline",
};

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};

/** Teachers and admins run the course; a TA only reads and grades. */
export function canManageCourse(role: CourseRole | null | undefined) {
  return role === "admin" || role === "teacher";
}

/**
 * A stable hue per course, so each card and header keeps its colour without
 * storing one. Derived from the id rather than the name so renaming a course
 * does not repaint it.
 */
export function courseHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function courseColor(id: string): string {
  return `hsl(${courseHue(id)} 62% 48%)`;
}

export function courseGradient(id: string): string {
  const hue = courseHue(id);
  return `linear-gradient(135deg, hsl(${hue} 62% 48%), hsl(${(hue + 40) % 360} 62% 42%))`;
}

export function personName(p: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unnamed";
}

export function initials(p: {
  firstName: string | null;
  lastName: string | null;
}): string {
  const value = `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`;
  return value.toUpperCase() || "?";
}

export function formatDue(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** An ISO instant as the local wall clock a datetime-local input expects. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 10) / 10}%`;
}
