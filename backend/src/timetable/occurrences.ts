import { addDays, daysBetween, isoWeekday, zonedToUtc } from '@/common/time-zone';

/**
 * Turning timetable entries into dated occurrences. Pure: everything comes
 * in as plain values, so the rules (weekly and rotating cycles, closures,
 * overrides, term bounds) are tested without a database.
 */

export interface CycleSettings {
  /** null = weekly timetable. */
  cycleLength: number | null;
  /** First day of cycle day 1 (`YYYY-MM-DD`); required with a cycle. */
  cycleStartDate: string | null;
  /** ISO weekdays the school is open. */
  schoolDays: number[];
}

export interface Closure {
  startDate: string;
  endDate: string;
}

export interface PeriodTimes {
  id: string;
  name: string;
  position: number;
  /** ISO weekday → local minutes. */
  times: Map<number, { start: number; end: number }>;
}

export interface EntryInput {
  id: string;
  courseId: string;
  periodId: string;
  roomId: string | null;
  weekday: number | null;
  cycleDay: number | null;
  /** Effective bounds: the entry's own dates, else the course term's. */
  from: string | null;
  to: string | null;
}

export interface OverrideInput {
  entryId: string;
  occursOn: string;
  kind: 'cancel' | 'move';
  movedDate: string | null;
  movedStart: number | null;
  movedEnd: number | null;
  movedRoomId: string | null;
  note: string | null;
}

export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'moved';

export interface Occurrence {
  entryId: string;
  courseId: string;
  periodId: string;
  /** The scheduled (original) date: with entryId, the occurrence's key. */
  occursOn: string;
  /** Where it actually happens (the moved date for a move). */
  date: string;
  startMinute: number;
  endMinute: number;
  roomId: string | null;
  status: OccurrenceStatus;
  note: string | null;
  /** The rotating cycle day of `occursOn`, null for a weekly timetable. */
  cycleDay: number | null;
}

export class SchoolCalendar {
  private readonly closures: Closure[];
  private readonly days: Set<number>;
  /** School day → number of school days before it since the cycle start. */
  private readonly indexMemo = new Map<string, number>();

  constructor(
    private readonly settings: CycleSettings,
    closures: Closure[],
  ) {
    this.closures = [...closures].sort((a, b) => a.startDate.localeCompare(b.startDate));
    this.days = new Set(settings.schoolDays);
  }

  isClosed(date: string): boolean {
    return this.closures.some((c) => c.startDate <= date && date <= c.endDate);
  }

  /** Open weekday and not a closure. */
  isSchoolDay(date: string): boolean {
    return this.days.has(isoWeekday(date)) && !this.isClosed(date);
  }

  /**
   * The rotating cycle day (1..N) of a school day, counting school days
   * from the cycle start; null on a non-school day, before the start, or
   * for a weekly timetable.
   */
  cycleDay(date: string): number | null {
    const { cycleLength, cycleStartDate } = this.settings;
    if (!cycleLength || !cycleStartDate) return null;
    if (date < cycleStartDate || !this.isSchoolDay(date)) return null;
    return (this.cycleIndex(date, cycleStartDate) % cycleLength) + 1;
  }

  /** School days in [start, date). Walks back to the nearest memoised day. */
  private cycleIndex(date: string, start: string): number {
    const known = this.indexMemo.get(date);
    if (known !== undefined) return known;
    let count = 0;
    let d = date;
    let index: number | null = null;
    while (index === null) {
      d = addDays(d, -1);
      if (d < start) {
        index = count;
        break;
      }
      if (!this.isSchoolDay(d)) continue;
      const k = this.indexMemo.get(d);
      if (k !== undefined) index = k + 1 + count;
      else count++;
    }
    this.indexMemo.set(date, index);
    return index;
  }
}

function inBounds(e: EntryInput, date: string) {
  return (!e.from || date >= e.from) && (!e.to || date <= e.to);
}

/** Does the entry's slot fall on this (original) date? */
function scheduledOn(e: EntryInput, date: string, cal: SchoolCalendar): boolean {
  if (!inBounds(e, date) || !cal.isSchoolDay(date)) return false;
  if (e.weekday !== null) return isoWeekday(date) === e.weekday;
  return e.cycleDay !== null && cal.cycleDay(date) === e.cycleDay;
}

/**
 * Every occurrence of `entries` that happens in [from, to] (inclusive local
 * days): scheduled, cancelled (at its original date) or moved in. An
 * occurrence moved out of the range is left out; one moved in from outside
 * is included.
 */
export function occurrencesBetween(
  from: string,
  to: string,
  input: {
    settings: CycleSettings;
    closures: Closure[];
    periods: Map<string, PeriodTimes>;
    entries: EntryInput[];
    overrides: OverrideInput[];
  },
): Occurrence[] {
  const cal = new SchoolCalendar(input.settings, input.closures);
  const overrideOf = new Map(
    input.overrides.map((o) => [`${o.entryId}|${o.occursOn}`, o]),
  );
  const span = daysBetween(from, to);
  if (span < 0) return [];

  const candidates: { e: EntryInput; date: string }[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    for (const e of input.entries) candidates.push({ e, date });
  }
  // Moves into the range from an original date outside it.
  const byId = new Map(input.entries.map((e) => [e.id, e]));
  for (const o of input.overrides) {
    if (o.kind !== 'move' || !o.movedDate) continue;
    if (o.movedDate < from || o.movedDate > to) continue;
    if (o.occursOn >= from && o.occursOn <= to) continue;
    const e = byId.get(o.entryId);
    if (e) candidates.push({ e, date: o.occursOn });
  }

  const out: Occurrence[] = [];
  for (const { e, date } of candidates) {
    if (!scheduledOn(e, date, cal)) continue;
    const period = input.periods.get(e.periodId);
    const time = period?.times.get(isoWeekday(date));
    if (!period || !time) continue;
    const base: Occurrence = {
      entryId: e.id,
      courseId: e.courseId,
      periodId: e.periodId,
      occursOn: date,
      date,
      startMinute: time.start,
      endMinute: time.end,
      roomId: e.roomId,
      status: 'scheduled',
      note: null,
      cycleDay: e.cycleDay !== null ? cal.cycleDay(date) : null,
    };
    const o = overrideOf.get(`${e.id}|${date}`);
    if (o?.kind === 'cancel') {
      if (date >= from && date <= to) out.push({ ...base, status: 'cancelled', note: o.note });
      continue;
    }
    if (o?.kind === 'move' && o.movedDate && o.movedStart !== null && o.movedEnd !== null) {
      const moved: Occurrence = {
        ...base,
        date: o.movedDate,
        startMinute: o.movedStart,
        endMinute: o.movedEnd,
        roomId: o.movedRoomId ?? e.roomId,
        status: 'moved',
        note: o.note,
      };
      if (moved.date >= from && moved.date <= to) out.push(moved);
      continue;
    }
    if (date >= from && date <= to) out.push(base);
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinute - b.startMinute ||
      a.courseId.localeCompare(b.courseId),
  );
}

/** The UTC instants an occurrence starts and ends in the school's zone. */
export function occurrenceInstants(o: Pick<Occurrence, 'date' | 'startMinute' | 'endMinute'>, tz: string) {
  return {
    startsAt: zonedToUtc(o.date, o.startMinute, tz),
    endsAt: zonedToUtc(o.date, o.endMinute, tz),
  };
}
