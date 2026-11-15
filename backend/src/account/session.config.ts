/**
 * Session settings, read from the environment on each call so tests can
 * change them.
 *
 * - `SESSION_MAX_AGE_DAYS` (default 90): the absolute lifetime of a session.
 *   However active it is, a session ends this long after sign-in.
 * - `SESSION_IDLE_DAYS` (default 30): a session unused for this long ends.
 * - `STAFF_SESSION_IDLE_HOURS` (default 168, 7 days) and
 *   `STAFF_SESSION_MAX_DAYS` (default 30): the same for staff accounts
 *   (`account_type` staff, or a school admin), who can see many children's
 *   records. Never longer than the general values above.
 * - `SESSION_ROTATION_GRACE_SECONDS` (default 120): how long a token keeps
 *   working after the daily rotation replaced it, for requests already in
 *   flight. After that it counts as a copied token, unless the client
 *   plainly never got the new one (LOST_ROTATION_GRACE_MS in session.service).
 * - `SESSION_ALERTS_ENABLED` (default true): email users about sign-ins from a
 *   new device and about sessions ended for token reuse.
 */

const DAY_MS = 24 * 60 * 60_000;

function numberFrom(raw: string | undefined, fallback: number, min: number): number {
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export function sessionMaxAgeMs(): number {
  return numberFrom(process.env.SESSION_MAX_AGE_DAYS, 90, 1) * DAY_MS;
}

export function sessionIdleMs(): number {
  return numberFrom(process.env.SESSION_IDLE_DAYS, 30, 1) * DAY_MS;
}

const HOUR_MS = 60 * 60_000;

export type SessionKind = 'standard' | 'staff';

export interface SessionPolicy {
  /** Sliding expiry: unused this long, the session ends. */
  idleMs: number;
  /** Absolute lifetime from sign-in. */
  maxAgeMs: number;
}

/** Idle and absolute lifetimes for a kind of account. */
export function sessionPolicy(kind: SessionKind): SessionPolicy {
  const idleMs = sessionIdleMs();
  const maxAgeMs = sessionMaxAgeMs();
  if (kind === 'standard') return { idleMs, maxAgeMs };
  return {
    idleMs: Math.min(idleMs, numberFrom(process.env.STAFF_SESSION_IDLE_HOURS, 168, 1) * HOUR_MS),
    maxAgeMs: Math.min(maxAgeMs, numberFrom(process.env.STAFF_SESSION_MAX_DAYS, 30, 1) * DAY_MS),
  };
}

/**
 * How long after the last renewal a used session is renewed (its expiry
 * slid and its token rotated): a day, or half the shortest idle time when
 * that is shorter, so an active session never lapses between renewals.
 */
export function renewAfterMs(): number {
  const shortest = Math.min(sessionPolicy('standard').idleMs, sessionPolicy('staff').idleMs);
  return Math.min(DAY_MS, Math.floor(shortest / 2));
}

export function rotationGraceMs(): number {
  return numberFrom(process.env.SESSION_ROTATION_GRACE_SECONDS, 120, 0) * 1000;
}

export function sessionAlertsEnabled(): boolean {
  return process.env.SESSION_ALERTS_ENABLED?.trim().toLowerCase() !== 'false';
}

/** How far back a sign-in from the same device counts as "known". */
export const KNOWN_DEVICE_WINDOW_MS = 90 * DAY_MS;
