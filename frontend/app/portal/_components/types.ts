/** Shapes returned by the /portal/me endpoints. */

import type { Course, CourseGrade } from "@/lib/courses/types";
import { formatScore } from "@/lib/format-number";

export interface PortalMe {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  enrollmentDate: string | null;
  school: {
    id: string;
    name: string | null;
    type: string | null;
    logoUrl: string | null;
  } | null;
}

export interface PortalTeacher {
  userProfileId?: string;
  role?: "teacher" | "ta";
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

/** `GET /portal/me/courses/:courseId` - the course plus who teaches it. */
export type PortalCourseDetail = Omit<
  Course,
  "role" | "studentCount" | "joinCode"
> & {
  teachers: PortalTeacher[];
  grade?: CourseGrade | null;
};

/** Course announcements, same shape as the staff announcement list. */
export interface PortalAnnouncement {
  id: string;
  title: string;
  body: string | null;
  created_at: string | null;
  updated_at: string | null;
  author?: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}

export function personName(p: {
  firstName?: string | null;
  lastName?: string | null;
}) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || "Teacher";
}

export function teacherNames(teachers: PortalTeacher[] | undefined | null) {
  const list = (teachers ?? []).map(personName);
  if (list.length === 0) return null;
  if (list.length <= 2) return list.join(" & ");
  return `${list[0]} + ${list.length - 1} more`;
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatScore(value)}%`;
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

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
