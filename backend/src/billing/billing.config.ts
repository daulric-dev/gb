import { primaryOrigin } from '@/config/origins';
import type { BillingPlan, PlanPrice } from './providers/payment-provider';

/**
 * Billing settings, read from the environment.
 *
 * Billing is for the hosted platform only. A self-hosted deployment leaves
 * BILLING_ENABLED unset: no trial, no read-only mode, no 402s, and every
 * /api/billing and /api/platform route answers 404 (except the status probe
 * the apps use to hide billing UI).
 */
export interface BillingConfig {
  enabled: boolean;
  perUserCents: number;
  flatCents: number;
  currency: string;
  trialDays: number;
  graceDays: number;
  /** PLATFORM_ADMIN_EMAILS, lower-cased. */
  platformAdminEmails: Set<string>;
  /** The web app's origin, for checkout return URLs. */
  appUrl: string;
}

type Env = Record<string, string | undefined>;

const TRUE = new Set(['1', 'true', 'yes', 'on']);

function bool(value: string | undefined): boolean {
  return TRUE.has((value ?? '').trim().toLowerCase());
}

/** A non-negative integer, or the fallback when unset or malformed. */
function int(value: string | undefined, fallback: number, min = 0): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= min ? n : fallback;
}

/** A comma list, trimmed, lower-cased, without empties. */
export function csvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

function currency(value: string | undefined): string {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

function appUrl(env: Env): string {
  const configured = env.APP_URL?.trim().replace(/\/+$/, '');
  return configured || primaryOrigin().replace(/\/+$/, '');
}

export function loadBillingConfig(env: Env = process.env): BillingConfig {
  return {
    enabled: bool(env.BILLING_ENABLED),
    perUserCents: int(env.BILLING_PER_USER_CENTS, 500),
    flatCents: int(env.BILLING_FLAT_CENTS, 30000),
    currency: currency(env.BILLING_CURRENCY),
    trialDays: int(env.BILLING_TRIAL_DAYS, 30),
    graceDays: int(env.BILLING_GRACE_DAYS, 7),
    platformAdminEmails: csvSet(env.PLATFORM_ADMIN_EMAILS),
    appUrl: appUrl(env),
  };
}

/**
 * The hot-path check (every mutating request asks it), so it reads only the
 * one variable rather than parsing the whole config.
 */
export function billingEnabled(env: Env = process.env): boolean {
  return bool(env.BILLING_ENABLED);
}

export const PLANS: readonly BillingPlan[] = ['per_user', 'flat'];

export function isPlan(value: unknown): value is BillingPlan {
  return value === 'per_user' || value === 'flat';
}

export function planPrice(cfg: BillingConfig, plan: BillingPlan): PlanPrice {
  return {
    plan,
    unitAmountCents: plan === 'flat' ? cfg.flatCents : cfg.perUserCents,
    currency: cfg.currency,
    interval: 'month',
  };
}

/** Seats billed for a plan: the billable users for per_user (at least 1), 1 for flat. */
export function seatsFor(plan: BillingPlan, billableUsers: number): number {
  return plan === 'flat' ? 1 : Math.max(1, billableUsers);
}

export function amountFor(
  cfg: BillingConfig,
  plan: BillingPlan,
  billableUsers: number,
): number {
  return planPrice(cfg, plan).unitAmountCents * seatsFor(plan, billableUsers);
}

/** `${APP_URL}/dashboard/settings/billing?checkout=success|cancel`. */
export function billingReturnUrl(
  cfg: BillingConfig,
  outcome: 'success' | 'cancel',
): string {
  return `${cfg.appUrl}/dashboard/settings/billing?checkout=${outcome}`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Same day-of-month a month later (clamped: Jan 31 -> Feb 28/29). */
export function addMonth(date: Date): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
