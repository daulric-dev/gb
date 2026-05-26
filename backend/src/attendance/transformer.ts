import type { AttendanceStatus } from './dto/mark-attendance.dto';

export interface AttendanceRecordItem {
  id: string;
  studentId: string;
  studentGroupId: string;
  date: string;
  status: AttendanceStatus;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RosterEntry {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  record: AttendanceRecordItem | null;
}

export interface ClassRosterAttendance {
  date: string;
  classId: string;
  entries: RosterEntry[];
}

export interface BulkAttendanceResponse {
  marked: number;
  message: string;
}

export interface StudentAttendanceRange {
  studentId: string;
  classId: string;
  from: string;
  to: string;
  records: AttendanceRecordItem[];
}

export interface StudentAttendanceSummary {
  studentId: string;
  classId: string;
  from: string;
  to: string;
  counts: {
    present: number;
    absent: number;
    late: number;
    total: number;
  };
  presentPercentage: number;
}

export interface MessageResponse {
  message: string;
}

export function v1Roster(data: ClassRosterAttendance): ClassRosterAttendance {
  return data;
}

export function v1Marked(raw: AttendanceRecordItem): AttendanceRecordItem {
  return raw;
}

export function v1BulkMarked(
  raw: BulkAttendanceResponse,
): BulkAttendanceResponse {
  return raw;
}

export function v1Updated(raw: AttendanceRecordItem): AttendanceRecordItem {
  return raw;
}

export function v1Deleted(raw: MessageResponse): MessageResponse {
  return raw;
}

export function v1StudentRange(
  raw: StudentAttendanceRange,
): StudentAttendanceRange {
  return raw;
}

export function v1StudentSummary(
  raw: StudentAttendanceSummary,
): StudentAttendanceSummary {
  return raw;
}
