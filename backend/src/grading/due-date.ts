/**
 * Due dates and per-student extensions.
 *
 * A student's effective due date is their extension's when they have one,
 * else the activity's own; null means there is no deadline. After it the
 * student can no longer start, save, hand in or attach anything - except in a
 * quiz attempt they started in time, which runs to its own end.
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

/** True once a deadline has passed. No deadline never passes. */
export function isPastDue(dueAt: When, now: number = Date.now()): boolean {
  const due = toDate(dueAt);
  return due !== null && due.getTime() <= now;
}

/**
 * When an in-progress quiz attempt ends: its own expiry, or - an attempt
 * with no time limit started before the due date - the due date. Null is an
 * attempt that never ends (no time limit, no deadline).
 */
export function quizAttemptEndsAt(
  attempt: { quiz_started_at: When; quiz_expires_at: When },
  dueAt: When,
): Date | null {
  return toDate(attempt.quiz_expires_at) ?? toDate(dueAt);
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
 * Closed to the student: past their effective due date and not inside a
 * quiz attempt that is still allowed to run.
 */
export function isClosedForStudent(
  dueAt: When,
  attempt?: { quiz_started_at: When; quiz_expires_at: When } | null,
  now: number = Date.now(),
): boolean {
  if (!isPastDue(dueAt, now)) return false;
  return !isQuizAttemptOpen(attempt, dueAt, now);
}

/**
 * The expiry to stamp on a new quiz attempt: the time limit from now, or with
 * no time limit the due date, so the attempt ends (and is submitted by the
 * expiry sweep) when the work is due.
 */
export function newQuizAttemptExpiry(
  startedAt: Date,
  timeLimitMinutes: number | null | undefined,
  dueAt: When,
): Date | null {
  if (timeLimitMinutes) {
    return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
  }
  return toDate(dueAt);
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

/** Throws the past-due 409 when the deadline has gone. */
export function assertNotPastDue(dueAt: When, now: number = Date.now()) {
  if (isPastDue(dueAt, now)) throw pastDueError(dueAt);
}

/**
 * The due date fields on every student-facing activity: the date that
 * applies to them, whether it is an extension, and whether the work has
 * closed to them.
 */
export function studentDueFields(
  activityDueAt: When,
  extensionDueAt: When,
  attempt?: { quiz_started_at: When; quiz_expires_at: When } | null,
  now: number = Date.now(),
) {
  const effective = effectiveDueAt(activityDueAt, extensionDueAt);
  return {
    effectiveDueAt: effective ? effective.toISOString() : null,
    hasExtension: toDate(extensionDueAt) !== null,
    isClosed: isClosedForStudent(effective, attempt, now),
  };
}
