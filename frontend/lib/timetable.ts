/**
 * Timetable types and helpers (backend `src/timetable`). Dates are plain
 * `YYYY-MM-DD` local school days; times of day are minutes after midnight.
 */

export interface TimetableSettings {
  /** The zone times are computed in: the school's, or UTC while none is set. */
  timeZone: string;
  /** False until an admin sets the school's zone; nothing opens automatically meanwhile. */
  timeZoneSet: boolean;
  /** null = weekly timetable. */
  cycleLength: number | null;
  cycleStartDate: string | null;
  /** ISO weekdays, 1 = Monday. */
  schoolDays: number[];
  autoSessions: boolean;
  leadMinutes: number;
  lateAfterMinutes: number | null;
  requireCode: boolean;
}

export interface Room {
  id: string;
  name: string;
  location: { latitude: number; longitude: number; radiusM: number } | null;
}

export interface PeriodTime {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Period {
  id: string;
  name: string;
  position: number;
  times: PeriodTime[];
}

export interface SchoolClosure {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

/** GET /schools/current/timetable */
export interface TimetableSetup {
  settings: TimetableSettings;
  rooms: Room[];
  periods: Period[];
  closures: SchoolClosure[];
  today: string;
}

/** GET /schools/current/timetable/cycle */
export interface CyclePreview {
  from: string;
  to: string;
  days: {
    date: string;
    weekday: number;
    schoolDay: boolean;
    closed: boolean;
    cycleDay: number | null;
  }[];
}

export interface TimetableEntry {
  id: string;
  courseId: string;
  periodId: string;
  periodName: string;
  roomId: string | null;
  roomName: string | null;
  weekday: number | null;
  cycleDay: number | null;
  validFrom: string | null;
  validTo: string | null;
}

/** GET /courses/:courseId/timetable */
export interface CourseTimetable {
  canEdit: boolean;
  entries: TimetableEntry[];
  settings: TimetableSettings;
  periods: Period[];
  rooms: Room[];
  term: { name: string | null; startDate: string | null; endDate: string | null } | null;
}

export type OccurrenceStatus = "scheduled" | "cancelled" | "moved";

export interface TimetableOccurrence {
  entryId: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  periodId: string;
  periodName: string;
  /** The scheduled date (with entryId, the key for cancel / move). */
  occursOn: string;
  /** Where it happens (the new date when moved). */
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
  /** Staff views: the automatic session, once the scheduler handled it. */
  session?: { id: string | null; state: "opened" | "skipped"; reason: string | null } | null;
}

/** GET /timetable/me, /portal/me/timetable, /courses/:id/timetable/occurrences */
export interface OccurrenceRange {
  from: string;
  to: string;
  today: string;
  timeZone?: string;
  /** False while the school has no time zone (times are then UTC). */
  timeZoneSet?: boolean;
  occurrences: TimetableOccurrence[];
}

// ── Weekdays ────────────────────────────────────────────────────────────────

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday (1 = Monday) as "Monday", or "Mon" with `short`. */
export function weekdayLabel(day: number, short = false): string {
  const name = LONG[day - 1] ?? "";
  return short ? name.slice(0, 3) : name;
}

/** How an entry repeats: "Monday" or "Day 3". */
export function entryDayLabel(e: { weekday: number | null; cycleDay: number | null }): string {
  if (e.weekday !== null) return weekdayLabel(e.weekday);
  if (e.cycleDay !== null) return `Day ${e.cycleDay}`;
  return "";
}

// ── Times ───────────────────────────────────────────────────────────────────

/** 545 → "09:05". 1440 (end of day) → "24:00". */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:05" → 545; null when it is not a valid HH:MM (00:00 to 24:00). */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

export function timeRange(start: number, end: number): string {
  return `${minutesToTime(start)}–${minutesToTime(end)}`;
}

// ── Calendar days (zone-free) ───────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar day. */
export function isoWeekday(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Monday..Sunday of the week containing `date`. */
export function weekOf(date: string): { from: string; to: string } {
  const from = addDays(date, 1 - isoWeekday(date));
  return { from, to: addDays(from, 6) };
}

/** Every day from `from` to `to` inclusive. */
export function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "Mon 9 Nov" for a calendar day (no time zone involved). */
export function formatDay(date: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    ...(opts.weekday === false ? {} : { weekday: "short" }),
    day: "numeric",
    month: "short",
    ...(opts.year ? { year: "numeric" } : {}),
  });
}

/** The browser's own zone, offered as the school's when none is set. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** A few zones for runtimes without `Intl.supportedValuesOf`. */
const FALLBACK_ZONES = [
  "UTC",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Port_of_Spain",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/London",
  "Europe/Paris",
  "Pacific/Auckland",
];

/**
 * Every IANA zone this browser knows (sorted, UTC included), for the school
 * time zone picker; a short list where `Intl.supportedValuesOf` is missing.
 * `extra` (the saved zone, the browser's own) is added when absent.
 */
export function timeZoneOptions(...extra: (string | null | undefined)[]): string[] {
  let zones: string[] = FALLBACK_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") {
      const list = supported("timeZone");
      if (list.length > 0) zones = list;
    }
  } catch {
    // Keep the fallback.
  }
  const all = new Set([...zones, "UTC"]);
  for (const z of extra) if (z) all.add(z);
  return [...all].sort((a, b) => a.localeCompare(b));
}

const offsetCache = new Map<string, string>();

/**
 * The zone's offset from UTC right now, e.g. "UTC-4", "UTC+5:30" or "UTC"
 * (it changes with daylight saving time, so `at` defaults to now). ASCII
 * signs, so typing "-4" in the picker finds it. Empty for an unknown zone.
 */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string {
  const key = `${zone}|${at.toISOString().slice(0, 13)}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  let label = "";
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT-4", "GMT+5:30", "GMT" (some runtimes use the U+2212 minus sign).
    const m = /^GMT(?:([+\-\u2212])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
    if (m) {
      const hours = Number(m[2] ?? 0);
      const minutes = m[3] && m[3] !== "00" ? `:${m[3]}` : "";
      // "GMT" and "GMT+0" (runtimes differ) are both plain UTC.
      label = !m[1] || (hours === 0 && !minutes) ? "UTC" : `UTC${m[1] === "+" ? "+" : "-"}${hours}${minutes}`;
    }
  } catch {
    // Unknown zone: no offset.
  }
  if (offsetCache.size > 2000) offsetCache.clear();
  offsetCache.set(key, label);
  return label;
}

/** "America/New_York (UTC-4)" for the picker and its search. */
export function timeZoneLabel(zone: string, at?: Date): string {
  const offset = utcOffsetLabel(zone, at);
  return offset && offset !== zone ? `${zone} (${offset})` : zone;
}

/** Whether `tz` is a zone this browser can format in (the API checks too). */
export function isKnownTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Occurrences grouped by the day they happen, in order. */
export function groupByDay(list: TimetableOccurrence[]): Map<string, TimetableOccurrence[]> {
  const out = new Map<string, TimetableOccurrence[]>();
  for (const o of [...list].sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute)) {
    const day = out.get(o.date) ?? [];
    day.push(o);
    out.set(o.date, day);
  }
  return out;
}

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  moved: "Moved",
};
