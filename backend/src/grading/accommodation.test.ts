import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import {
  accommodatedTimeLimit,
  accommodationColumns,
  effectiveAccommodation,
  lockdownFor,
} from './accommodation';
import { newQuizAttemptExpiry } from './due-date';

const row = (over: Record<string, unknown> = {}) => ({
  time_multiplier: null,
  extra_minutes: null,
  lockdown_exempt: false,
  ...over,
});

describe('effectiveAccommodation', () => {
  test('none at all is null', () => {
    expect(effectiveAccommodation(null, null)).toBeNull();
  });

  test('the school-wide default applies when the activity has none', () => {
    const acc = effectiveAccommodation(null, row({ time_multiplier: '1.5' }));
    expect(acc).toEqual({
      source: 'student',
      timeMultiplier: 1.5,
      extraMinutes: null,
      lockdownExempt: false,
    });
  });

  test("the activity's row replaces the default entirely", () => {
    const acc = effectiveAccommodation(
      row({ extra_minutes: 10 }),
      row({ time_multiplier: 2, lockdown_exempt: true }),
    );
    expect(acc).toEqual({
      source: 'activity',
      timeMultiplier: null,
      extraMinutes: 10,
      lockdownExempt: false,
    });
  });
});

describe('accommodatedTimeLimit', () => {
  const by = (over: Record<string, unknown>) =>
    effectiveAccommodation(row(over), null);

  test('×1.5 on a 30-minute quiz is 45 minutes', () => {
    expect(accommodatedTimeLimit(30, by({ time_multiplier: 1.5 }))).toBe(45);
  });

  test('a multiplier rounds up to a whole minute', () => {
    expect(accommodatedTimeLimit(25, by({ time_multiplier: 1.25 }))).toBe(32);
  });

  test('extra minutes are added', () => {
    expect(accommodatedTimeLimit(30, by({ extra_minutes: 20 }))).toBe(50);
  });

  test('no accommodation, or a Lockdown-only one, keeps the limit', () => {
    expect(accommodatedTimeLimit(30, null)).toBe(30);
    expect(accommodatedTimeLimit(30, by({ lockdown_exempt: true }))).toBe(30);
  });

  test('an untimed quiz stays untimed', () => {
    expect(accommodatedTimeLimit(null, by({ time_multiplier: 2 }))).toBeNull();
  });

  test('an untimed attempt still ends at the due date, not later', () => {
    const start = new Date('2026-11-10T10:00:00Z');
    const due = new Date('2026-11-10T11:00:00Z');
    const limit = accommodatedTimeLimit(null, by({ extra_minutes: 600 }));
    expect(newQuizAttemptExpiry(start, limit, due)).toEqual(due);
  });

  test('the default applies to the quiz when nothing overrides it', () => {
    const acc = effectiveAccommodation(null, row({ extra_minutes: 15 }));
    expect(accommodatedTimeLimit(30, acc)).toBe(45);
  });
});

describe('lockdownFor', () => {
  test('an exempt student is not locked down', () => {
    const acc = effectiveAccommodation(row({ lockdown_exempt: true }), null);
    expect(lockdownFor(true, acc)).toBe(false);
    expect(lockdownFor(true, null)).toBe(true);
    expect(lockdownFor(false, null)).toBe(false);
  });
});

describe('accommodationColumns', () => {
  test('accepts a multiplier, extra minutes, or an exemption', () => {
    expect(accommodationColumns({ timeMultiplier: 1.5, reason: ' ok ' })).toEqual({
      time_multiplier: 1.5,
      extra_minutes: null,
      lockdown_exempt: false,
      reason: 'ok',
    });
    expect(accommodationColumns({ extraMinutes: 600 }).extra_minutes).toBe(600);
    expect(accommodationColumns({ lockdownExempt: true }).lockdown_exempt).toBe(
      true,
    );
  });

  test('refuses both kinds of time at once', () => {
    expect(() =>
      accommodationColumns({ timeMultiplier: 2, extraMinutes: 10 }),
    ).toThrow('not both');
  });

  test('refuses other multipliers and out-of-range minutes', () => {
    for (const bad of [
      { timeMultiplier: 3 },
      { timeMultiplier: 1.1 },
      { extraMinutes: 0 },
      { extraMinutes: 601 },
      { extraMinutes: 1.5 },
    ]) {
      expect(() => accommodationColumns(bad)).toThrow(BadRequestException);
    }
  });

  test('refuses an accommodation that changes nothing', () => {
    expect(() => accommodationColumns({ reason: 'x' })).toThrow(
      'Give extra time or a Lockdown exemption',
    );
  });
});
