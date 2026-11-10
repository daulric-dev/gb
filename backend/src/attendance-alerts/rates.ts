import { tally } from '@/attendance/attendance.service';
import type { AttendanceStatus, AttendanceTally } from '@/attendance/attendance.types';

/**
 * Attendance percentages and alert conditions, as pure functions.
 *
 * The rate is the attendance module's `tally`: (present + late) over every
 * record that counts, where excused records do not count either way; null
 * when nothing counts. A student is only measured over sessions they have a
 * record in, so joining a course late is not absence.
 */

export interface DatedRecord {
  status: AttendanceStatus;
  /** When the session opened. */
  at: Date;
}

export { tally };
export type { AttendanceTally };

/** Records counted (everything but excused). */
export const counted = (t: AttendanceTally) => t.present + t.late + t.absent;

/**
 * Absences in a row at the end of the history, newest first: excused
 * records are skipped (they neither break nor extend the run); present or
 * late ends it.
 */
export function trailingAbsences(records: DatedRecord[]): number {
  const sorted = [...records].sort((a, b) => b.at.getTime() - a.at.getTime());
  let run = 0;
  for (const r of sorted) {
    if (r.status === 'excused') continue;
    if (r.status !== 'absent') break;
    run++;
  }
  return run;
}

export interface AlertThresholds {
  /** Percent; null = no rate check. */
  minRate: number | null;
  windowDays: number;
  /** Counted records needed in the window before the rate is judged. */
  minSessions: number;
  /** null = no run check. */
  consecutiveAbsences: number | null;
}

export type AlertKind = 'low_rate' | 'consecutive_absences';

export interface Condition {
  kind: AlertKind;
  /** Whether the condition holds now. */
  active: boolean;
  /** Whether an open alert of this kind may be resolved now. */
  recovered: boolean;
  value: number;
  threshold: number;
}

/**
 * Evaluate one student's conditions. `window` is the records inside the
 * rate window; `history` is a longer run of recent records for the
 * absences-in-a-row check.
 *
 * Re-alerting needs a recovery: a low-rate alert is only resolved once the
 * student has enough counted records again and is at or above the
 * threshold, or has no counted records at all in the window (nothing left
 * to judge), so a thin window does not open and close alerts by turns.
 */
export function evaluate(
  t: AlertThresholds,
  window: DatedRecord[],
  history: DatedRecord[],
): Condition[] {
  const out: Condition[] = [];
  if (t.minRate !== null) {
    const w = tally(window);
    const n = counted(w);
    const rate = w.rate ?? 100;
    out.push({
      kind: 'low_rate',
      active: n >= t.minSessions && rate < t.minRate,
      recovered: n === 0 || (n >= t.minSessions && rate >= t.minRate),
      value: w.rate ?? 0,
      threshold: t.minRate,
    });
  }
  if (t.consecutiveAbsences !== null) {
    const run = trailingAbsences(history);
    out.push({
      kind: 'consecutive_absences',
      active: run >= t.consecutiveAbsences,
      recovered: run === 0,
      value: run,
      threshold: t.consecutiveAbsences,
    });
  }
  return out;
}

/** Human wording of an alert, shared by emails, the parent notice and the UI. */
export function describeAlert(a: {
  kind: string;
  value: number;
  threshold: number;
  windowDays: number | null;
}): string {
  if (a.kind === 'consecutive_absences') {
    return `${a.value} absences in a row (alert at ${a.threshold}).`;
  }
  const weeks = a.windowDays && a.windowDays % 7 === 0 ? `${a.windowDays / 7} weeks` : `${a.windowDays ?? 0} days`;
  return `Attendance ${a.value}% over the last ${weeks}, below ${a.threshold}%.`;
}
