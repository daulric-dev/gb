/**
 * Due dates, late work and per-student extensions.
 *
 * A student's effective due date is their extension's when they have one,
 * else the activity's own; null means there is no deadline. Work closes to
 * them at their extension when they have one (it wins entirely: no late
 * window, no penalty), else at the activity's `late_until` when it accepts
 * late work, else at the due date. After that close the student can no
 * longer start, save, hand in or attach anything - except in a quiz attempt
 * they started in time, which runs to its own end. Between the due date and
 * the close, hand-ins are accepted and marked late (see late-policy.ts).
 */

import { ConflictException } from '@nestjs/common';

type When = Date | string | null | undefined;

function toDate(value: When): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The extension's due date when there is one, else the activity's. */
export function effectiveDueAt(
  activityDueAt: When,
  extensionDueAt?: When,
): Date | null {
  return toDate(extensionDueAt) ?? toDate(activityDueAt);
}

/**
 * When the work closes to this student: their extension, else the
 * activity's late-until, else its due date. Null never closes.
 */
export function effectiveCloseAt(
  activityDueAt: When,
  lateUntil: When,
  extensionDueAt?: When,
): Date | null {
  return toDate(extensionDueAt) ?? toDate(lateUntil) ?? toDate(activityDueAt);
}

/** True once a deadline has passed. No deadline never passes. */
export function isPastDue(dueAt: When, now: number = Date.now()): boolean {
  const due = toDate(dueAt);
  return due !== null && due.getTime() <= now;
}

/**
 * When an in-progress quiz attempt ends: its own expiry, or (an attempt from
 * before expiries were stamped) the close date passed in. Null is an attempt
 * that never ends (no time limit, no deadline).
 */
export function quizAttemptEndsAt(
  attempt: { quiz_started_at: When; quiz_expires_at: When },
  closeAt: When,
): Date | null {
  return toDate(attempt.quiz_expires_at) ?? toDate(closeAt);
}

/**
 * Whether a quiz attempt is still running: started, and not past its end.
 */
export function isQuizAttemptOpen(
  attempt: { quiz_started_at: When; quiz_expires_at: When } | null | undefined,
  dueAt: When,
  now: number = Date.now(),
): boolean {
  if (!attempt || !toDate(attempt.quiz_started_at)) return false;
  const end = quizAttemptEndsAt(attempt, dueAt);
  return end === null || end.getTime() > now;
}

/**
 * Closed to the student: past their close date (see effectiveCloseAt) and
 * not inside a quiz attempt that is still allowed to run.
 */
export function isClosedForStudent(
  closeAt: When,
  attempt?: { quiz_started_at: When; quiz_expires_at: When } | null,
  now: number = Date.now(),
): boolean {
  if (!isPastDue(closeAt, now)) return false;
  return !isQuizAttemptOpen(attempt, closeAt, now);
}

/**
 * When an untimed attempt started at `startedAt` ends: the due date when it
 * was started on time (late work is not a way to get more time), else the
 * close date (an attempt started in the late window runs until work closes).
 */
export function untimedAttemptEnd(
  startedAt: Date,
  dueAt: When,
  closeAt: When = dueAt,
): Date | null {
  const due = toDate(dueAt);
  if (due && startedAt.getTime() < due.getTime()) return due;
  return toDate(closeAt) ?? due;
}

/**
 * The expiry to stamp on a new quiz attempt: the time limit from now, or with
 * no time limit the due date (or, started late, the close date), so the
 * attempt ends (and is submitted by the expiry sweep) then.
 */
export function newQuizAttemptExpiry(
  startedAt: Date,
  timeLimitMinutes: number | null | undefined,
  dueAt: When,
  closeAt: When = dueAt,
): Date | null {
  if (timeLimitMinutes) {
    return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
  }
  return untimedAttemptEnd(startedAt, dueAt, closeAt);
}

/** e.g. "2026-11-05 14:00 UTC": the server does not know the reader's time zone. */
export function formatDueDate(dueAt: When): string {
  const due = toDate(dueAt);
  if (!due) return '';
  return `${due.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The 409 for anything a student tries after their due date. */
export function pastDueError(dueAt: When) {
  return new ConflictException(
    `This was due on ${formatDueDate(dueAt)}. Ask your teacher for an extension`,
  );
}

/**
 * The 409 for anything a student tries after work has closed to them: the
 * past-due message, or - when it accepted late work - when late work closed.
 */
export function closedError(closeAt: When, dueAt: When) {
  const close = toDate(closeAt);
  const due = toDate(dueAt);
  if (close && due && close.getTime() !== due.getTime()) {
    return new ConflictException(
      `Late work closed on ${formatDueDate(close)}. Ask your teacher for an extension`,
    );
  }
  return pastDueError(dueAt ?? closeAt);
}

/** Throws the past-due 409 when the deadline has gone. */
export function assertNotPastDue(dueAt: When, now: number = Date.now()) {
  if (isPastDue(dueAt, now)) throw pastDueError(dueAt);
}

/** Throws the closed 409 once work has closed to the student. */
export function assertNotClosed(
  closeAt: When,
  dueAt: When,
  now: number = Date.now(),
) {
  if (isPastDue(closeAt, now)) throw closedError(closeAt, dueAt);
}

/**
 * The due date fields on every student-facing activity: the date that
 * applies to them, whether it is an extension, until when late work is
 * accepted from them (null with an extension or no late window), whether it
 * is now late, and whether the work has closed to them.
 *
 * `activity` is the activity's due date, or its row with `late_until`.
 */
export function studentDueFields(
  activity: When | { due_at: When; late_until?: When },
  extensionDueAt: When,
  attempt?: { quiz_started_at: When; quiz_expires_at: When } | null,
  now: number = Date.now(),
) {
  const row =
    activity && typeof activity === 'object' && !(activity instanceof Date)
      ? activity
      : { due_at: activity as When, late_until: null };
  const effective = effectiveDueAt(row.due_at, extensionDueAt);
  const hasExtension = toDate(extensionDueAt) !== null;
  const closeAt = effectiveCloseAt(row.due_at, row.late_until, extensionDueAt);
  const lateUntil =
    !hasExtension && toDate(row.late_until) ? closeAt : null;
  const isClosed = isClosedForStudent(closeAt, attempt, now);
  return {
    effectiveDueAt: effective ? effective.toISOString() : null,
    hasExtension,
    lateUntil: lateUntil ? lateUntil.toISOString() : null,
    isLate: !isClosed && isPastDue(effective, now),
    isClosed,
  };
}
