import { envInt } from '@/erasure/erasure.config';

/** Attempts per delivery before it is abandoned (first try included). */
export const maxAttempts = () => Math.max(1, envInt('WEBHOOK_MAX_ATTEMPTS', 8));
/** Failed deliveries in a row after which a webhook switches itself off. */
export const maxConsecutiveFailures = () =>
  Math.max(1, envInt('WEBHOOK_MAX_CONSECUTIVE_FAILURES', 50));
/** Days a delivery (and its payload) is kept. */
export const deliveryRetentionDays = () =>
  Math.max(1, envInt('WEBHOOK_DELIVERY_RETENTION_DAYS', 30));
/** How often the database worker looks for due deliveries. */
export const pollIntervalMs = () => Math.max(500, envInt('WEBHOOK_POLL_INTERVAL_MS', 5000));

/** Per request: connect, send and the start of the response. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** At most this much of the receiver's response is read and kept. */
export const RESPONSE_EXCERPT_BYTES = 1024;
/** A claimed delivery is someone's for this long; a crashed worker's comes back after it. */
export const CLAIM_LEASE_MS = 2 * 60_000;
/** Due deliveries one worker claims per round. */
export const CLAIM_BATCH = 20;

/**
 * Wait before attempt `n + 1`, after `n` failed attempts (n >= 1): 1 min,
 * 5 min, 30 min, 2 h, 5 h, 8 h, 8 h - about 24 hours over the default 8
 * attempts - each with up to ±20% jitter so receivers that come back are
 * not hit by every retry at once. `random` is injectable for tests.
 */
export const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  5 * 3_600_000,
  8 * 3_600_000,
  8 * 3_600_000,
] as const;

export function backoffMs(failedAttempts: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(Math.max(failedAttempts, 1), BACKOFF_MS.length) - 1];
  const jitter = (random() * 2 - 1) * 0.2;
  return Math.round(base * (1 + jitter));
}
