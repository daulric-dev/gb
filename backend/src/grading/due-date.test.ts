import { describe, expect, test } from 'bun:test';
import { ConflictException } from '@nestjs/common';
import {
  assertNotPastDue,
  effectiveDueAt,
  isClosedForStudent,
  isPastDue,
  isQuizAttemptOpen,
  newQuizAttemptExpiry,
  pastDueError,
  studentDueFields,
} from './due-date';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const PAST = new Date('2026-11-04T12:00:00.000Z');
const FUTURE = new Date('2026-11-06T12:00:00.000Z');

describe('effective due date', () => {
  test('an extension wins over the activity date', () => {
    expect(effectiveDueAt(PAST, FUTURE)).toEqual(FUTURE);
  });

  test('an extension may also be earlier than the activity date', () => {
    expect(effectiveDueAt(FUTURE, PAST)).toEqual(PAST);
  });

  test('without an extension the activity date applies', () => {
    expect(effectiveDueAt(PAST, null)).toEqual(PAST);
    expect(effectiveDueAt(PAST)).toEqual(PAST);
  });

  test('no dates at all is no deadline', () => {
    expect(effectiveDueAt(null, null)).toBeNull();
  });

  test('accepts ISO strings', () => {
    expect(effectiveDueAt('2026-11-04T12:00:00.000Z', null)).toEqual(PAST);
  });
});

describe('past due', () => {
  test('a date in the past has passed, the future has not', () => {
    expect(isPastDue(PAST, NOW)).toBe(true);
    expect(isPastDue(FUTURE, NOW)).toBe(false);
  });

  test('no deadline never passes', () => {
    expect(isPastDue(null, NOW)).toBe(false);
  });

  test('the due instant itself is past', () => {
    expect(isPastDue(new Date(NOW), NOW)).toBe(true);
  });

  test('the refusal is a 409 naming the date', () => {
    const error = pastDueError(PAST);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(
      'This was due on 2026-11-04 12:00 UTC. Ask your teacher for an extension',
    );
    expect(() => assertNotPastDue(PAST, NOW)).toThrow(ConflictException);
    expect(() => assertNotPastDue(FUTURE, NOW)).not.toThrow();
    expect(() => assertNotPastDue(null, NOW)).not.toThrow();
  });
});

describe('quiz attempts and the due date', () => {
  const started = new Date('2026-11-04T11:50:00.000Z');

  test('a timed attempt begun before the due date runs to its own expiry', () => {
    const attempt = {
      quiz_started_at: started,
      quiz_expires_at: new Date(NOW + 60_000),
    };
    expect(isQuizAttemptOpen(attempt, PAST, NOW)).toBe(true);
    expect(isClosedForStudent(PAST, attempt, NOW)).toBe(false);
  });

  test('a timed attempt past its expiry is over', () => {
    const attempt = {
      quiz_started_at: started,
      quiz_expires_at: new Date(NOW - 1),
    };
    expect(isQuizAttemptOpen(attempt, FUTURE, NOW)).toBe(false);
  });

  test('an attempt with no expiry ends at the due date', () => {
    const attempt = { quiz_started_at: started, quiz_expires_at: null };
    expect(isQuizAttemptOpen(attempt, PAST, NOW)).toBe(false);
    expect(isQuizAttemptOpen(attempt, FUTURE, NOW)).toBe(true);
    expect(isQuizAttemptOpen(attempt, null, NOW)).toBe(true);
  });

  test('no attempt is never open', () => {
    expect(isQuizAttemptOpen(null, FUTURE, NOW)).toBe(false);
    expect(
      isQuizAttemptOpen(
        { quiz_started_at: null, quiz_expires_at: null },
        FUTURE,
        NOW,
      ),
    ).toBe(false);
  });

  test('a new attempt expires at its time limit, or at the due date', () => {
    const at = new Date(NOW);
    expect(newQuizAttemptExpiry(at, 30, FUTURE)).toEqual(
      new Date(NOW + 30 * 60_000),
    );
    expect(newQuizAttemptExpiry(at, null, FUTURE)).toEqual(FUTURE);
    expect(newQuizAttemptExpiry(at, null, null)).toBeNull();
  });
});

describe('student due fields', () => {
  test('past the activity date, no extension: closed', () => {
    expect(studentDueFields(PAST, null, null, NOW)).toEqual({
      effectiveDueAt: PAST.toISOString(),
      hasExtension: false,
      lateUntil: null,
      isLate: false,
      isClosed: true,
    });
  });

  test('an extension reopens the work', () => {
    expect(studentDueFields(PAST, FUTURE, null, NOW)).toEqual({
      effectiveDueAt: FUTURE.toISOString(),
      hasExtension: true,
      lateUntil: null,
      isLate: false,
      isClosed: false,
    });
  });

  test('undated work never closes', () => {
    expect(studentDueFields(null, null, null, NOW)).toEqual({
      effectiveDueAt: null,
      hasExtension: false,
      lateUntil: null,
      isLate: false,
      isClosed: false,
    });
  });
});
