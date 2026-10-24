/**
 * Attendance wire types, copied from the attendance section of
 * `frontend/lib/courses/types.ts`, plus small display helpers.
 */

import { useEffect, useState } from "react";
import * as Location from "expo-location";

export type AttendanceStatus = "present" | "late" | "absent" | "excused";
export type AttendanceMethod = "self" | "teacher" | "auto" | "qr";

export interface AttendanceSession {
  id: string;
  courseId: string;
  title: string | null;
  openedBy: string | null;
  openedAt: string;
  closesAt: string;
  /** null while the session is open. */
  closedAt: string | null;
  isOpen: boolean;
  /** Staff only; never sent to students. null when no code is required. */
  checkInCode: string | null;
  requiresCode: boolean;
  lateAfterMinutes: number | null;
  /** Present when the teacher asked for a location check. */
  location: { latitude: number; longitude: number; radiusM: number } | null;
  counts: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    pending: number;
  };
}

export interface AttendanceRosterEntry {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  hasAccount: boolean;
  /** null while the session is open and the student has not checked in. */
  status: AttendanceStatus | null;
  method: AttendanceMethod | null;
  checkedInAt: string | null;
  distanceM: number | null;
  note: string | null;
}

export interface AttendanceSessionDetail extends AttendanceSession {
  roster: AttendanceRosterEntry[];
}

/** What a student sees of an open session: no code, no teacher location. */
export interface PortalOpenAttendance {
  sessionId: string;
  courseId: string;
  courseName: string;
  title: string | null;
  openedAt: string;
  closesAt: string;
  requiresCode: boolean;
  requiresLocation: boolean;
  /** The student's own record if they have already checked in. */
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
  summary: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    rate: number | null;
  };
  records: PortalAttendanceRecord[];
}

/** One frame of the rotating QR shown on the teacher's screen. */
export interface AttendanceQrFrame {
  token: string;
  /** `<web origin>/portal/attendance/scan?s=<sessionId>&t=<token>` */
  url: string;
  /** ISO time the token rotates. */
  rotatesAt: string;
  windowMs: number;
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
};

/** Milliseconds left until `closesAt`, re-rendered every second. */
export function useRemaining(closesAt: string | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!closesAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closesAt]);
  if (!closesAt) return 0;
  return Math.max(0, new Date(closesAt).getTime() - now);
}

/** "4:07" */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isQrToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/**
 * True for the path part of an attendance scan link: `/scan` or
 * `/portal/attendance/scan`, as a full URL (`https://host/scan`), a custom
 * scheme (`gradebook://scan`, `gradebook://portal/attendance/scan`) or a bare
 * path. Query and hash must already be stripped.
 */
export function isScanPath(path: string): boolean {
  const rest = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Drop the host for http(s) links; custom schemes put the first segment there.
  const local = /^https?:/i.test(path) ? rest.replace(/^[^/]*/, "") : `/${rest}`;
  return /^\/+(portal\/attendance\/)?scan\/?$/.test(local);
}

/**
 * Reads `?s=<sessionId>&t=<token>` out of a scanned attendance URL
 * (`<web origin>/scan?...` or the older `<web origin>/portal/attendance/scan?...`).
 * Returns null for anything that
 * isn't one, so random QR codes are ignored rather than submitted.
 */
export function parseAttendanceQr(
  data: string,
): { sessionId: string; token: string } | null {
  const raw = data.trim();
  if (!raw || raw.length > 2048) return null;
  const query = raw.indexOf("?");
  if (query < 0) return null;
  const path = raw.slice(0, query).split("#")[0];
  if (!isScanPath(path)) return null;
  let s: string | null = null;
  let t: string | null = null;
  try {
    // Parsed by hand: React Native's URL/URLSearchParams are incomplete.
    for (const part of raw.slice(query + 1).split("#")[0].split("&")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const key = decodeURIComponent(part.slice(0, eq));
      const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
      if (key === "s") s = value;
      else if (key === "t") t = value;
    }
  } catch {
    return null;
  }
  if (!isSessionId(s) || !isQrToken(t)) return null;
  return { sessionId: s, token: t };
}

export type LocationFix = { latitude: number; longitude: number; accuracy?: number };

const LOCATION_TIMEOUT_MS = 15_000;

/** Ask for foreground location and take one high-accuracy reading. */
export async function currentLocation(): Promise<LocationFix> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      "Location is off for GradeBook. Allow it in Settings to check in.",
    );
  }
  const position = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Couldn't find your location. Try again.")),
        LOCATION_TIMEOUT_MS,
      ),
    ),
  ]);
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? undefined,
  };
}
