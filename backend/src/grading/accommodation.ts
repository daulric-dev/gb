/**
 * Per-student quiz accommodations: more time on a timed quiz and an
 * exemption from Lockdown.
 *
 * A student can have a school-wide default (grading.student_accommodation)
 * and an accommodation on one activity (grading.activity_accommodation). The
 * activity's row, when there is one, replaces the default entirely - it is
 * the teacher's decision for that quiz.
 *
 * Time only applies to quizzes with a time limit. An untimed attempt ends at
 * the student's due date (their extension, else the activity's); extra time
 * does not move that - a later due date is what an extension is for.
 */

import { BadRequestException } from '@nestjs/common';

/** The multipliers a teacher can choose. */
export const TIME_MULTIPLIERS = [1.25, 1.5, 2] as const;
export const MAX_EXTRA_MINUTES = 600;

type Numeric = number | string | { toString(): string } | null | undefined;

export type AccommodationRow = {
  time_multiplier: Numeric;
  extra_minutes: number | null | undefined;
  lockdown_exempt: boolean | null | undefined;
};

export type EffectiveAccommodation = {
  /** Where it came from: this activity, or the student's default. */
  source: 'activity' | 'student';
  timeMultiplier: number | null;
  extraMinutes: number | null;
  lockdownExempt: boolean;
};

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** The accommodation that applies: the activity's, else the default, else none. */
export function effectiveAccommodation(
  activityRow: AccommodationRow | null | undefined,
  studentDefault: AccommodationRow | null | undefined,
): EffectiveAccommodation | null {
  const row = activityRow ?? studentDefault;
  if (!row) return null;
  return {
    source: activityRow ? 'activity' : 'student',
    timeMultiplier: toNumber(row.time_multiplier),
    extraMinutes: row.extra_minutes ?? null,
    lockdownExempt: !!row.lockdown_exempt,
  };
}

/**
 * The student's time limit in minutes: the quiz's times the multiplier, or
 * plus the extra minutes. Rounded up to a whole minute, in the student's
 * favour. Null (no time limit) stays null.
 */
export function accommodatedTimeLimit(
  timeLimitMinutes: number | null | undefined,
  accommodation: EffectiveAccommodation | null | undefined,
): number | null {
  if (!timeLimitMinutes) return null;
  if (!accommodation) return timeLimitMinutes;
  if (accommodation.timeMultiplier) {
    return Math.ceil(timeLimitMinutes * accommodation.timeMultiplier);
  }
  if (accommodation.extraMinutes) {
    return timeLimitMinutes + accommodation.extraMinutes;
  }
  return timeLimitMinutes;
}

/** Whether Lockdown applies to this student on this quiz. */
export function lockdownFor(
  lockdownBrowser: boolean | null | undefined,
  accommodation: EffectiveAccommodation | null | undefined,
): boolean {
  return !!lockdownBrowser && !accommodation?.lockdownExempt;
}

/** The `QuizAccommodation` contract shown to staff. */
export function toAccommodationSummary(
  accommodation: EffectiveAccommodation | null,
) {
  return accommodation
    ? {
        source: accommodation.source,
        timeMultiplier: accommodation.timeMultiplier,
        extraMinutes: accommodation.extraMinutes,
        lockdownExempt: accommodation.lockdownExempt,
      }
    : null;
}

export type AccommodationInput = {
  timeMultiplier?: number | null;
  extraMinutes?: number | null;
  lockdownExempt?: boolean;
  reason?: string | null;
};

/**
 * Check a set request and turn it into columns. Time is a multiplier or
 * extra minutes, not both; and an accommodation must change something.
 */
export function accommodationColumns(input: AccommodationInput) {
  const multiplier = input.timeMultiplier ?? null;
  const extra = input.extraMinutes ?? null;
  if (multiplier !== null && extra !== null) {
    throw new BadRequestException(
      'Choose a time multiplier or extra minutes, not both',
    );
  }
  if (
    multiplier !== null &&
    !(TIME_MULTIPLIERS as readonly number[]).includes(multiplier)
  ) {
    throw new BadRequestException(
      `The time multiplier must be one of ${TIME_MULTIPLIERS.join(', ')}`,
    );
  }
  if (
    extra !== null &&
    (!Number.isInteger(extra) || extra < 1 || extra > MAX_EXTRA_MINUTES)
  ) {
    throw new BadRequestException(
      `Extra minutes must be a whole number from 1 to ${MAX_EXTRA_MINUTES}`,
    );
  }
  const lockdownExempt = !!input.lockdownExempt;
  if (multiplier === null && extra === null && !lockdownExempt) {
    throw new BadRequestException(
      'Give extra time or a Lockdown exemption',
    );
  }
  return {
    time_multiplier: multiplier,
    extra_minutes: extra,
    lockdown_exempt: lockdownExempt,
    reason: input.reason?.trim() || null,
  };
}
