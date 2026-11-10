/**
 * Wall-clock time in a school's IANA time zone, with nothing but `Intl`.
 *
 * Dates are plain `YYYY-MM-DD` strings (a calendar day, no zone) and times
 * of day are minutes after local midnight; `zonedToUtc` turns one into an
 * instant. Used by the timetable (when a period starts) and attendance
 * reports (which days a date range covers).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export const DEFAULT_TIME_ZONE = 'UTC';

/** Whether `tz` is an IANA zone this runtime knows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** A stored zone, or UTC when it is missing or unknown. */
export function safeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export interface LocalParts {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** Minutes after local midnight (0-1439). */
  minute: number;
  /** ISO weekday, 1 = Monday .. 7 = Sunday. */
  weekday: number;
}

function parts(instant: Date, tz: string) {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) out[p.type] = p.value;
  return out;
}

/** The local calendar day, minute and weekday of an instant in `tz`. */
export function localParts(instant: Date, tz: string): LocalParts {
  const p = parts(instant, tz);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minute: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS[p.weekday] ?? isoWeekday(`${p.year}-${p.month}-${p.day}`),
  };
}

/** Offset of `tz` from UTC at an instant, in milliseconds (east positive). */
export function offsetMs(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - whole;
}

/**
 * The instant at local `date` + `minute` in `tz`. A time skipped by a
 * clock change (spring forward) lands just after the gap; a repeated time
 * (fall back) is its first occurrence.
 */
export function zonedToUtc(date: string, minute: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  // The zone's offset half a day either side covers any one clock change.
  const candidates = [
    wall - offsetMs(new Date(wall - 12 * 3_600_000), tz),
    wall - offsetMs(new Date(wall + 12 * 3_600_000), tz),
    wall - offsetMs(new Date(wall), tz),
  ];
  const matching = candidates.filter((t) => {
    const p = localParts(new Date(t), tz);
    return p.date === date && p.minute === minute;
  });
  // Fall back: both readings are real; keep the earlier. Spring forward:
  // none is; the later one is just after the gap.
  return new Date(matching.length > 0 ? Math.min(...matching) : Math.max(...candidates));
}

// ── calendar-day arithmetic (zone-free) ─────────────────────────────────────

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** `b - a` in days. */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** ISO weekday (1 = Monday .. 7 = Sunday) of a calendar day. */
export function isoWeekday(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

/** A `@db.Date` value as `YYYY-MM-DD`. */
export function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** `YYYY-MM-DD` as the Date Prisma expects for a `@db.Date` column. */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
