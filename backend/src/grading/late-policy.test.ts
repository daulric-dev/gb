import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  applyLatePenalty,
  latePenaltyPercent,
  latePolicyColumns,
  latePolicyOf,
  lateSeconds,
  toLateness,
} from './late-policy';
import {
  assertNotClosed,
  closedError,
  effectiveCloseAt,
  newQuizAttemptExpiry,
  studentDueFields,
  untimedAttemptEnd,
} from './due-date';
import { refreshLateness } from './lateness';

const HOUR = 3_600;
const DAY = 86_400;
const DUE = new Date('2026-11-05T12:00:00.000Z');
const LATE_UNTIL = new Date('2026-11-08T12:00:00.000Z');
const EXT = new Date('2026-11-07T12:00:00.000Z');

const perDay = { mode: 'percent_per_day' as const, value: 10, cap: null };
const perHour = { mode: 'percent_per_hour' as const, value: 5, cap: null };

describe('lateness', () => {
  test('whole seconds after the due date; on time or undated is 0', () => {
    expect(lateSeconds(new Date(DUE.getTime() + 1500), DUE)).toBe(2);
    expect(lateSeconds(DUE, DUE)).toBe(0);
    expect(lateSeconds(new Date(DUE.getTime() - 1000), DUE)).toBe(0);
    expect(lateSeconds(new Date(), null)).toBe(0);
    expect(lateSeconds(null, DUE)).toBe(0);
  });
});

describe('late penalty percent', () => {
  test('a started day counts as a full day', () => {
    expect(latePenaltyPercent(perDay, 1)).toBe(10);
    expect(latePenaltyPercent(perDay, DAY)).toBe(10);
    expect(latePenaltyPercent(perDay, DAY + 1)).toBe(20);
    expect(latePenaltyPercent(perDay, 2 * DAY + 60)).toBe(30);
  });

  test('a started hour counts as a full hour', () => {
    expect(latePenaltyPercent(perHour, 60)).toBe(5);
    expect(latePenaltyPercent(perHour, HOUR + 1)).toBe(10);
    expect(latePenaltyPercent(perHour, 25 * HOUR)).toBe(100);
  });

  test('the cap limits the penalty, and nothing exceeds 100', () => {
    expect(latePenaltyPercent({ ...perDay, cap: 25 }, 5 * DAY)).toBe(25);
    expect(latePenaltyPercent(perDay, 30 * DAY)).toBe(100);
  });

  test('none, or on time, is 0', () => {
    expect(latePenaltyPercent({ mode: 'none', value: null, cap: null }, DAY)).toBe(0);
    expect(latePenaltyPercent(perDay, 0)).toBe(0);
  });

  test('percent of the mark: 85 less 10% is 76.5', () => {
    expect(applyLatePenalty(85, 10)).toBe(76.5);
    expect(applyLatePenalty(85, 0)).toBe(85);
    expect(applyLatePenalty(40, 100)).toBe(0);
  });

  test('a row with an unknown mode reads as none', () => {
    expect(latePolicyOf({ late_penalty_mode: 'weird', late_penalty_value: 5 })).toEqual({
      mode: 'none',
      value: null,
      cap: null,
    });
  });
});

describe('policy validation', () => {
  const base = { dueAt: DUE, lateUntil: LATE_UNTIL };
  test('accepts a policy and returns its columns', () => {
    expect(
      latePolicyColumns('assignment', { ...base, mode: 'percent_per_day', value: 10, cap: 50 }),
    ).toEqual({
      late_until: LATE_UNTIL,
      late_penalty_mode: 'percent_per_day',
      late_penalty_value: 10,
      late_penalty_cap: 50,
    });
  });
  test('late-until needs a due date before it', () => {
    expect(() => latePolicyColumns('quiz', { dueAt: null, lateUntil: LATE_UNTIL })).toThrow(
      BadRequestException,
    );
    expect(() => latePolicyColumns('quiz', { dueAt: LATE_UNTIL, lateUntil: DUE })).toThrow(
      BadRequestException,
    );
  });
  test('a penalty needs a late window and a value in range', () => {
    expect(() =>
      latePolicyColumns('quiz', { dueAt: DUE, lateUntil: null, mode: 'percent_per_day', value: 10 }),
    ).toThrow(BadRequestException);
    expect(() => latePolicyColumns('quiz', { ...base, mode: 'percent_per_hour', value: 0 })).toThrow(
      BadRequestException,
    );
    expect(() =>
      latePolicyColumns('quiz', { ...base, mode: 'percent_per_hour', value: 5, cap: 120 }),
    ).toThrow(BadRequestException);
  });
  test('offline work has no late policy', () => {
    expect(() => latePolicyColumns('offline', base)).toThrow(BadRequestException);
  });
  test('mode none clears the numbers', () => {
    expect(latePolicyColumns('quiz', { ...base, mode: 'none', value: 5 })).toMatchObject({
      late_penalty_value: null,
      late_penalty_cap: null,
    });
  });
});

describe('effective close date', () => {
  test('an extension wins entirely over late-until', () => {
    expect(effectiveCloseAt(DUE, LATE_UNTIL, EXT)).toEqual(EXT);
  });
  test('late-until, else the due date', () => {
    expect(effectiveCloseAt(DUE, LATE_UNTIL)).toEqual(LATE_UNTIL);
    expect(effectiveCloseAt(DUE, null)).toEqual(DUE);
    expect(effectiveCloseAt(null, null)).toBeNull();
  });
  test('after due, inside the window: open and late', () => {
    const now = DUE.getTime() + DAY * 1000;
    expect(studentDueFields({ due_at: DUE, late_until: LATE_UNTIL }, null, null, now)).toEqual({
      effectiveDueAt: DUE.toISOString(),
      hasExtension: false,
      lateUntil: LATE_UNTIL.toISOString(),
      isLate: true,
      isClosed: false,
    });
  });
  test('past late-until: closed, with the late-work message', () => {
    const now = LATE_UNTIL.getTime() + 1000;
    expect(studentDueFields({ due_at: DUE, late_until: LATE_UNTIL }, null, null, now).isClosed).toBe(
      true,
    );
    expect(() => assertNotClosed(LATE_UNTIL, DUE, now)).toThrow(ConflictException);
    expect(closedError(LATE_UNTIL, DUE).message).toContain('Late work closed');
    expect(closedError(DUE, DUE).message).toContain('This was due');
  });
  test('with an extension there is no late window', () => {
    const now = EXT.getTime() + 1000;
    const fields = studentDueFields({ due_at: DUE, late_until: LATE_UNTIL }, EXT, null, now);
    expect(fields.lateUntil).toBeNull();
    expect(fields.isClosed).toBe(true);
  });
  test('an untimed attempt started on time ends at the due date; started late, at the close', () => {
    expect(untimedAttemptEnd(new Date(DUE.getTime() - 1000), DUE, LATE_UNTIL)).toEqual(DUE);
    expect(untimedAttemptEnd(new Date(DUE.getTime() + 1000), DUE, LATE_UNTIL)).toEqual(LATE_UNTIL);
    expect(newQuizAttemptExpiry(new Date(DUE.getTime() + 1000), null, DUE, LATE_UNTIL)).toEqual(
      LATE_UNTIL,
    );
  });
});

describe('toLateness', () => {
  test('rounds the raw score and defaults the rest', () => {
    expect(toLateness({ raw_score: '85.004' })).toEqual({
      lateSeconds: 0,
      latePenaltyPercent: 0,
      latePenaltyWaived: false,
      rawScore: 85,
    });
  });
});

/** A transaction double for refreshLateness. */
function txWith(
  activity: Record<string, unknown>,
  submissions: Record<string, unknown>[],
  extensions: { student_id: string; due_at: Date }[] = [],
) {
  const update = mock(async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({}));
  const tx = {
    activity: { findUnique: mock(async () => activity) },
    submission: { findMany: mock(async () => submissions), update },
    activity_extension: { findMany: mock(async () => extensions) },
  };
  return { tx, update };
}

const policyRow = {
  kind: 'assignment',
  due_at: DUE,
  late_penalty_mode: 'percent_per_day',
  late_penalty_value: 10,
  late_penalty_cap: null,
};
const sub = (over: Record<string, unknown>) => ({
  id: 's1',
  student_id: 'st1',
  submitted_at: new Date(DUE.getTime() + DAY * 1000 + 1000),
  attempt_started_at: null,
  score: 85,
  raw_score: 85,
  late_seconds: 0,
  late_penalty_percent: 0,
  late_penalty_waived: false,
  ...over,
});

describe('refreshLateness', () => {
  test('a mark handed in a day and a second late loses 20%', async () => {
    const { tx, update } = txWith(policyRow, [sub({})]);
    await refreshLateness(tx as never, 'a1');
    expect(update.mock.calls[0][0].data).toEqual({
      late_seconds: DAY + 1,
      late_penalty_percent: 20,
      score: 68,
    });
  });

  test('an extension later than the hand-in removes the lateness', async () => {
    const { tx, update } = txWith(policyRow, [sub({ score: 68, late_seconds: DAY + 1, late_penalty_percent: 20 })], [
      { student_id: 'st1', due_at: EXT },
    ]);
    await refreshLateness(tx as never, 'a1');
    expect(update.mock.calls[0][0].data).toEqual({
      late_seconds: 0,
      late_penalty_percent: 0,
      score: 85,
    });
  });

  test('a waived penalty keeps the raw mark but records the lateness', async () => {
    const { tx, update } = txWith(policyRow, [sub({ late_penalty_waived: true })]);
    await refreshLateness(tx as never, 'a1');
    expect(update.mock.calls[0][0].data).toEqual({
      late_seconds: DAY + 1,
      late_penalty_percent: 20,
      score: 85,
    });
  });

  test('a quiz is late by when its attempt started, not when it was submitted', async () => {
    const { tx, update } = txWith({ ...policyRow, kind: 'quiz' }, [
      sub({ attempt_started_at: new Date(DUE.getTime() - 60_000) }),
    ]);
    await refreshLateness(tx as never, 'a1');
    expect(update).not.toHaveBeenCalled();
  });

  test('a mark with no raw score (imported) keeps its score', async () => {
    const { tx, update } = txWith(policyRow, [sub({ raw_score: null, score: 50 })]);
    await refreshLateness(tx as never, 'a1');
    expect(update.mock.calls[0][0].data).toEqual({ late_seconds: DAY + 1, late_penalty_percent: 20 });
  });

  test('unchanged rows are not written', async () => {
    const { tx, update } = txWith(policyRow, [
      sub({ score: 68, late_seconds: DAY + 1, late_penalty_percent: 20 }),
    ]);
    await refreshLateness(tx as never, 'a1');
    expect(update).not.toHaveBeenCalled();
  });
});
