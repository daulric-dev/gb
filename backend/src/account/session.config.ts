/**
 * Session settings, read from the environment on each call so tests can
 * change them.
 *
 * - `SESSION_MAX_AGE_DAYS` (default 90): the absolute lifetime of a session.
 *   However active it is, a session ends this long after sign-in.
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

export function rotationGraceMs(): number {
  return numberFrom(process.env.SESSION_ROTATION_GRACE_SECONDS, 120, 0) * 1000;
}

export function sessionAlertsEnabled(): boolean {
  return process.env.SESSION_ALERTS_ENABLED?.trim().toLowerCase() !== 'false';
}

/** How far back a sign-in from the same device counts as "known". */
export const KNOWN_DEVICE_WINDOW_MS = 90 * DAY_MS;
