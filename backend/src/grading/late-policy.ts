/**
 * Late-work policy: how late a hand-in was and the penalty that gives.
 *
 * An activity may accept work after its due date until `late_until`, taking
 * `late_penalty_value` percent off the mark per day or hour late, at most
 * `late_penalty_cap` percent (and never more than 100).
 *
 * Rounding: every started day or hour counts in full, so one minute late on
 * a 10%-per-day policy is 10%, and 25 hours late is 20%. Lateness is whole
 * seconds after the student's effective due date (their extension, else the
 * activity's). A quiz's lateness is when its attempt was started, not when it
 * was submitted: an attempt begun in time runs its own length without penalty.
 *
 * The penalty is a percentage of the mark, not of the points: 85 with 10%
 * late is 85 × 0.9 = 76.5.
 */

import { BadRequestException } from '@nestjs/common';
import { scoreOrNull } from './round';

export const LATE_PENALTY_MODES = [
  'none',
  'percent_per_day',
  'percent_per_hour',
] as const;
export type LatePenaltyMode = (typeof LATE_PENALTY_MODES)[number];

type Numeric = number | string | { toString(): string } | null | undefined;
type When = Date | string | null | undefined;

export type LatePolicy = {
  mode: LatePenaltyMode;
  value: number | null;
  cap: number | null;
};

const SECONDS: Record<Exclude<LatePenaltyMode, 'none'>, number> = {
  percent_per_day: 86_400,
  percent_per_hour: 3_600,
};

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function toDate(value: When): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The policy from an activity row's columns. */
export function latePolicyOf(row: {
  late_penalty_mode?: string | null;
  late_penalty_value?: Numeric;
  late_penalty_cap?: Numeric;
}): LatePolicy {
  const mode = (LATE_PENALTY_MODES as readonly string[]).includes(
    row.late_penalty_mode ?? '',
  )
    ? (row.late_penalty_mode as LatePenaltyMode)
    : 'none';
  return {
    mode,
    value: mode === 'none' ? null : toNumber(row.late_penalty_value),
    cap: mode === 'none' ? null : toNumber(row.late_penalty_cap),
  };
}

/** Whole seconds `at` is after `dueAt`; 0 when on time or undated. */
export function lateSeconds(at: When, dueAt: When): number {
  const when = toDate(at);
  const due = toDate(dueAt);
  if (!when || !due) return 0;
  const ms = when.getTime() - due.getTime();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** The percent the policy takes off for this lateness (0 to 100). */
export function latePenaltyPercent(policy: LatePolicy, late: number): number {
  if (policy.mode === 'none' || !policy.value || late <= 0) return 0;
  const units = Math.ceil(late / SECONDS[policy.mode]);
  let percent = units * policy.value;
  if (policy.cap !== null && policy.cap !== undefined) {
    percent = Math.min(percent, policy.cap);
  }
  return Math.min(Math.round(percent * 100) / 100, 100);
}

/** The mark after the penalty. Full precision; rounding is for display. */
export function applyLatePenalty(rawScore: number, percent: number): number {
  if (!percent) return rawScore;
  return (rawScore * (100 - percent)) / 100;
}

export type LatePolicyInput = {
  dueAt: Date | null;
  lateUntil: Date | null;
  mode?: LatePenaltyMode;
  value?: number | null;
  cap?: number | null;
};

/**
 * Check a policy and turn it into columns. Late work needs a due date and a
 * later "accept until"; a penalty needs late work to apply to.
 */
export function latePolicyColumns(kind: string, input: LatePolicyInput) {
  const mode = input.mode ?? 'none';
  if (kind === 'offline' && (input.lateUntil || mode !== 'none')) {
    throw new BadRequestException(
      'Offline work is not handed in, so it has no late policy',
    );
  }
  if (input.lateUntil) {
    if (!input.dueAt) {
      throw new BadRequestException('Set a due date before accepting late work');
    }
    if (input.lateUntil.getTime() <= input.dueAt.getTime()) {
      throw new BadRequestException(
        'Late work must be accepted until after the due date',
      );
    }
  }
  if (mode === 'none') {
    return {
      late_until: input.lateUntil,
      late_penalty_mode: 'none' as const,
      late_penalty_value: null,
      late_penalty_cap: null,
    };
  }
  if (!input.lateUntil) {
    throw new BadRequestException(
      'Choose until when late work is accepted before setting a penalty',
    );
  }
  const value = input.value ?? null;
  if (value === null || !(value > 0 && value <= 100)) {
    throw new BadRequestException(
      'The late penalty must be more than 0 and at most 100 percent',
    );
  }
  const cap = input.cap ?? null;
  if (cap !== null && !(cap > 0 && cap <= 100)) {
    throw new BadRequestException(
      'The penalty cap must be more than 0 and at most 100 percent',
    );
  }
  return {
    late_until: input.lateUntil,
    late_penalty_mode: mode,
    late_penalty_value: value,
    late_penalty_cap: cap,
  };
}

/** The `LatePolicy` contract on activities (staff and students). */
export function toLatePolicy(row: {
  late_until?: When;
  late_penalty_mode?: string | null;
  late_penalty_value?: Numeric;
  late_penalty_cap?: Numeric;
}) {
  const policy = latePolicyOf(row);
  const until = toDate(row.late_until);
  return {
    lateUntil: until ? until.toISOString() : null,
    latePenaltyMode: policy.mode,
    latePenaltyValue: policy.value,
    latePenaltyCap: policy.cap,
  };
}

/** The lateness fields on a submission, for staff and the student. */
export function toLateness(row: {
  raw_score?: Numeric;
  late_seconds?: number | null;
  late_penalty_percent?: Numeric;
  late_penalty_waived?: boolean | null;
}) {
  const percent = toNumber(row.late_penalty_percent) ?? 0;
  return {
    lateSeconds: row.late_seconds ?? 0,
    latePenaltyPercent: percent,
    latePenaltyWaived: !!row.late_penalty_waived,
    rawScore: scoreOrNull(row.raw_score),
  };
}
