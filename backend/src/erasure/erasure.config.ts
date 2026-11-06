import { createHmac } from 'node:crypto';
import { authSecret, dataEncryptionKey } from '@/account/secret';

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

const SIGNING_LABEL = 'gradebook:erasure-log:v1';

function hmacKey(root: string): Buffer {
  return createHmac('sha256', root).update(SIGNING_LABEL).digest();
}

/**
 * HMAC key for new entries in the storage copy; derived so the root secret
 * itself is never used directly. The root is DATA_ENCRYPTION_KEY when set,
 * else AUTH_SECRET (as before it existed).
 */
export function signingKey(): Buffer {
  return hmacKey((dataEncryptionKey() ?? authSecret()));
}

/** The AUTH_SECRET-derived key: what every entry written before DATA_ENCRYPTION_KEY was signed with. */
export function legacySigningKey(): Buffer {
  return hmacKey(authSecret());
}

/**
 * Every key a stored entry's signature is accepted under: the current
 * signing key first, then the AUTH_SECRET one. Entries are immutable once
 * exported, so setting DATA_ENCRYPTION_KEY must not make older entries fail
 * verification; they keep verifying while AUTH_SECRET is unchanged. Before
 * rotating AUTH_SECRET, re-sign them under DATA_ENCRYPTION_KEY with
 * `bun run secrets:reencrypt` (scripts/reencrypt-secrets.ts).
 */
export function verificationKeys(): Buffer[] {
  const current = signingKey();
  const legacy = legacySigningKey();
  return current.equals(legacy) ? [current] : [current, legacy];
}
