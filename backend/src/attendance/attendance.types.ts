/**
 * Wire shapes for attendance. Mirrors the attendance section of
 * frontend/lib/courses/types.ts; keep the two in step.
 */

import type { LocationFlag } from './location-flags';

export type { LocationFlag } from './location-flags';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type AttendanceMethod = 'self' | 'qr' | 'teacher' | 'auto';

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  'present',
  'late',
  'absent',
  'excused',
];

export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
  pending: number;
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  title: string | null;
  openedBy: string | null;
  openedAt: string;
  closesAt: string;
  closedAt: string | null;
  isOpen: boolean;
  checkInCode: string | null;
  requiresCode: boolean;
  lateAfterMinutes: number | null;
  location: { latitude: number; longitude: number; radiusM: number } | null;
  /**
   * When the session point was last set: at open, then each time staff
   * shared a newer position. null without a location check.
   */
  locationUpdatedAt: string | null;
  counts: AttendanceCounts;
}

export interface AttendanceRosterEntry {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  hasAccount: boolean;
  status: AttendanceStatus | null;
  method: AttendanceMethod | null;
  checkedInAt: string | null;
  distanceM: number | null;
  /** Reported GPS accuracy of the check-in, metres. Staff only. */
  accuracyM: number | null;
  /**
   * Suspicious-reading markers (see location-flags.ts). Staff only; never in
   * any portal response. Empty when nothing looked odd.
   */
  locationFlags: LocationFlag[];
  note: string | null;
}

export interface AttendanceSessionDetail extends AttendanceSession {
  roster: AttendanceRosterEntry[];
}

export interface AttendanceTally {
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
}

export interface AttendanceStudentSummary extends AttendanceTally {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AttendanceCourseSummary {
  sessionCount: number;
  students: AttendanceStudentSummary[];
}

export interface PortalOpenAttendance {
  sessionId: string;
  courseId: string;
  courseName: string;
  title: string | null;
  openedAt: string;
  closesAt: string;
  requiresCode: boolean;
  requiresLocation: boolean;
  myStatus: AttendanceStatus | null;
}

export interface PortalAttendanceRecord {
  sessionId: string;
  title: string | null;
  openedAt: string;
  status: AttendanceStatus | null;
  checkedInAt: string | null;
}

export interface PortalCourseAttendance {
  summary: AttendanceTally;
  records: PortalAttendanceRecord[];
}
