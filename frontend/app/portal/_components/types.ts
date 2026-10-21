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
  school: { id: string; name: string | null; type: string | null } | null;
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

/** A stable accent per course so cards are easy to tell apart. */
const ACCENTS = [
  "from-sky-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
  "from-lime-500 to-green-600",
  "from-fuchsia-500 to-violet-600",
];

export function courseAccent(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(hash) % ACCENTS.length];
}
