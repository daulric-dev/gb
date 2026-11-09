/**
 * Attendance reports and alerts (backend `src/attendance-alerts`), plus the
 * student's own summary (`GET /portal/me/attendance/summary`).
 */
import type { AttendanceStatus } from "@/lib/courses/types";

export interface Tally {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Present + late over everything but excused; null when nothing counts. */
  rate: number | null;
}

export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}

export interface ReportStudentRow extends Tally {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  formTutorId: string | null;
  openAlerts: string[];
}

export interface ReportCourseRow extends Tally {
  courseId: string;
  name: string;
  code: string | null;
  students: number;
}

/** GET /attendance-reports/school */
export interface SchoolReport {
  range: ReportRange;
  overall: Tally;
  sessions: number;
  courses: ReportCourseRow[];
  students: ReportStudentRow[];
}

/** GET /courses/:courseId/attendance-report */
export interface CourseReport {
  range: ReportRange;
  course: { id: string; name: string; code: string | null };
  overall: Tally;
  sessions: number;
  students: ReportStudentRow[];
}

/** GET /attendance-reports/students/:studentId */
export interface StudentReport {
  range: ReportRange;
  student: { id: string; firstName: string | null; lastName: string | null; formTutorId: string | null };
  overall: Tally;
  courses: (Tally & { courseId: string; name: string; code: string | null })[];
  records: { courseId: string; courseName: string; status: AttendanceStatus; openedAt: string }[];
  alerts: {
    id: string;
    kind: AlertKind;
    value: number;
    threshold: number;
    windowDays: number | null;
    openedAt: string;
    resolvedAt: string | null;
  }[];
}

export type AlertKind = "low_rate" | "consecutive_absences";

export interface AttendanceAlert {
  id: string;
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  /** The caller is this student's form tutor. */
  mine: boolean;
  kind: AlertKind;
  value: number;
  threshold: number;
  windowDays: number | null;
  description: string;
  openedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
}

/** GET /attendance-alerts */
export interface AlertList {
  canSeeSchool: boolean;
  alerts: AttendanceAlert[];
}

/** GET/PUT /attendance-alerts/settings */
export interface AlertSettings {
  minRate: number | null;
  windowDays: number;
  minSessions: number;
  consecutiveAbsences: number | null;
  notifyTutor: boolean;
  notifyAdmins: boolean;
  notifyParents: boolean;
  emailStaff: boolean;
}

/** GET /attendance-alerts/form-tutors */
export interface FormTutors {
  students: { id: string; firstName: string | null; lastName: string | null; formTutorId: string | null }[];
  staff: { id: string; firstName: string | null; lastName: string | null; email: string | null; role: string | null }[];
}

/** GET /portal/me/attendance/summary */
export interface PortalAttendanceSummary {
  overall: Tally;
  courses: { courseId: string; courseName: string; courseCode: string | null; archived: boolean; summary: Tally }[];
}

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  low_rate: "Low attendance",
  consecutive_absences: "Absences in a row",
};

/** The default report window: the last four weeks up to `today`. */
export function lastWeeks(today: string, weeks = 4): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - (weeks * 7 - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to: today };
}

/** Today in the browser, as `YYYY-MM-DD` (local, not UTC). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "from=…&to=…" for report URLs. */
export function rangeQuery(r: { from: string; to: string }): string {
  return new URLSearchParams({ from: r.from, to: r.to }).toString();
}

/** One decimal, like the API: 66.7%. "–" when nothing counted. */
export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "–";
  return `${Math.round(rate * 10) / 10}%`;
}

/** Counted sessions: everything but excused. */
export function countedSessions(t: Tally): number {
  return t.present + t.late + t.absent;
}

/** Lowest rate first (nothing counted last), then by name. */
export function byRateThenName<T extends Tally & { lastName: string | null; firstName: string | null }>(
  a: T,
  b: T,
): number {
  const ra = a.rate ?? Number.POSITIVE_INFINITY;
  const rb = b.rate ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  return `${a.lastName ?? ""} ${a.firstName ?? ""}`.localeCompare(`${b.lastName ?? ""} ${b.firstName ?? ""}`);
}
