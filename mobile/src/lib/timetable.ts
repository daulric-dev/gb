/**
 * Timetable and attendance-summary helpers. Mirrors the API shapes in
 * backend/src/timetable/timetable.service.ts and the attendance portal
 * summary (backend/src/attendance/attendance.types.ts).
 */

export type OccurrenceStatus = "scheduled" | "cancelled" | "moved";

export interface TimetableOccurrence {
  entryId: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  periodId: string;
  periodName: string;
  /** The scheduled (original) date; with entryId, the occurrence's key. */
  occursOn: string;
  /** Where it actually happens (the moved date for a move). */
  date: string;
  startMinute: number;
  endMinute: number;
  startsAt: string;
  endsAt: string;
  roomId: string | null;
  roomName: string | null;
  status: OccurrenceStatus;
  note: string | null;
  cycleDay: number | null;
  /** Staff only: the automatic session, once the scheduler handled it. */
  session?: { id: string | null; state: "opened" | "skipped"; reason: string | null } | null;
}

export interface TimetableRange {
  from: string;
  to: string;
  today: string;
  timeZone?: string;
  occurrences: TimetableOccurrence[];
}

export interface AttendanceTally {
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
}

/** GET /portal/me/attendance/summary */
export interface PortalAttendanceSummary {
  overall: AttendanceTally;
  courses: {
    courseId: string;
    courseName: string;
    courseCode: string | null;
    archived: boolean;
    summary: AttendanceTally;
  }[];
}

// ── calendar days (`YYYY-MM-DD`, no zone) ───────────────────────────────────

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Monday of the week a day falls in. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** The device's local day, as a starting point before the server answers. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "09:05" from minutes after midnight (the school's local time). */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeRange(o: Pick<TimetableOccurrence, "startMinute" | "endMinute">): string {
  return `${minuteLabel(o.startMinute)}–${minuteLabel(o.endMinute)}`;
}

/** "Monday 9 November" for a calendar day. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** "9 Nov" for a calendar day. */
export function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Occurrences grouped by the day they happen, in order. */
export function groupByDate(list: TimetableOccurrence[]): { date: string; items: TimetableOccurrence[] }[] {
  const map = new Map<string, TimetableOccurrence[]>();
  for (const o of [...list].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute,
  )) {
    const items = map.get(o.date) ?? [];
    items.push(o);
    map.set(o.date, items);
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

/** One line under a period: course code or room, cycle day. */
export function occurrenceDetail(o: TimetableOccurrence): string {
  return [
    o.periodName,
    o.roomName ? `Room ${o.roomName}` : null,
    o.cycleDay ? `Day ${o.cycleDay}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function statusLabel(o: TimetableOccurrence): string | null {
  if (o.status === "cancelled") return "Cancelled";
  if (o.status === "moved") {
    return o.date !== o.occursOn ? `Moved from ${shortDay(o.occursOn)}` : "Moved";
  }
  return null;
}

/** Where the period is now, relative to `now`. */
export function phase(o: TimetableOccurrence, now = Date.now()): "upcoming" | "now" | "past" {
  if (now < Date.parse(o.startsAt)) return "upcoming";
  if (now < Date.parse(o.endsAt)) return "now";
  return "past";
}

/** Path for cancel (PUT) / restore (DELETE) of one occurrence. */
export function occurrencePath(o: Pick<TimetableOccurrence, "courseId" | "entryId" | "occursOn">): string {
  return `/courses/${o.courseId}/timetable/occurrences/${o.entryId}/${o.occursOn}`;
}

/** "92.5%", or a dash when nothing counted yet. */
export function rateLabel(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "–" : `${rate}%`;
}
