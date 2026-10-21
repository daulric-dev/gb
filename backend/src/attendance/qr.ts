import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** How long one QR frame is valid before the screen shows the next. */
export const QR_WINDOW_MS = 15_000;

/** A fresh per-session secret. Stored on the session, never sent out. */
export function newQrSecret(): string {
  return randomBytes(32).toString('hex');
}

export function qrWindow(now: number): number {
  return Math.floor(now / QR_WINDOW_MS);
}

/**
 * The token for one time window: a truncated HMAC of the window number.
 * 128 bits is far more than a 15-second guess needs, and keeps the QR small.
 */
export function qrToken(secret: string, window: number): string {
  return createHmac('sha256', secret)
    .update(String(window))
    .digest('base64url')
    .slice(0, 22);
}

/**
 * Whether a scanned token is from the current window or the one before it.
 * The previous window is accepted so a student who scans just as the code
 * rotates, or on a slow connection, is not turned away.
 */
export function verifyQrToken(
  secret: string,
  token: string,
  now: number,
): boolean {
  const given = Buffer.from(token);
  const current = qrWindow(now);
  return [current, current - 1].some((w) => {
    const expected = Buffer.from(qrToken(secret, w));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** How long a scan claim lets a student take to sign in and finish. */
export const QR_CLAIM_TTL_MS = 10 * 60_000;

function claimMac(secret: string, sessionId: string, exp: number): string {
  return createHmac('sha256', secret)
    .update(`claim:${sessionId}:${exp}`)
    .digest('base64url')
    .slice(0, 32);
}

/**
 * Trade a live QR token for something that lasts long enough to sign in.
 *
 * A student who scans while signed out spends longer than a QR window on the
 * login code, so the scan page swaps the token for this claim first. It does
 * not widen the window for passing the code on: getting a claim still needs a
 * token that is live right now, exactly as checking in directly does.
 */
export function qrClaim(secret: string, sessionId: string, now: number): {
  claim: string;
  expiresAt: number;
} {
  const exp = now + QR_CLAIM_TTL_MS;
  return { claim: `${exp}.${claimMac(secret, sessionId, exp)}`, expiresAt: exp };
}

export function verifyQrClaim(
  secret: string,
  sessionId: string,
  claim: string,
  now: number,
): boolean {
  const [expPart, mac, extra] = claim.split('.');
  if (extra !== undefined || !expPart || !mac || !/^\d+$/.test(expPart)) {
    return false;
  }
  const exp = Number(expPart);
  if (exp < now || exp > now + QR_CLAIM_TTL_MS) return false;
  const expected = Buffer.from(claimMac(secret, sessionId, exp));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
