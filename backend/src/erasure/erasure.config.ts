import { createHmac } from 'node:crypto';
import { authSecret } from '@/account/secret';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A non-negative integer from the environment, or the fallback. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * How long erasure-log entries are kept (DB and storage copy). Must outlast
 * the longest backup that could be restored, so the default is well over the
 * 30-day dump + 7-day version window.
 */
export function erasureLogRetentionDays(): number {
  return Math.max(1, envInt('ERASURE_LOG_RETENTION_DAYS', 400));
}

export const erasureLogCutoff = (now: Date) =>
  new Date(now.getTime() - erasureLogRetentionDays() * DAY_MS);

/**
 * Where the off-database copy of the log goes, inside the app's bucket.
 * `off` (or `false`/`none`) turns the copy off; unset means `erasure-log`.
 */
export function erasureLogPrefix(): string | null {
  const raw = (process.env.ERASURE_LOG_S3_PREFIX ?? 'erasure-log').trim();
  if (raw === '' || ['off', 'false', 'none'].includes(raw.toLowerCase())) return null;
  return raw.replace(/^\/+|\/+$/g, '');
}

/** HMAC key for the storage copy; derived so AUTH_SECRET itself is never used directly. */
export function signingKey(): Buffer {
  return createHmac('sha256', authSecret()).update('gradebook:erasure-log:v1').digest();
}
