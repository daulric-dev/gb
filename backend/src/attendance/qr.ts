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

/**
 * How long a scan claim lets a student take to sign in and finish. Kept short:
 * the claim is a bearer token until it is redeemed, and redeeming it binds it
 * to one student (see AttendanceService.checkIn).
 */
export const QR_CLAIM_TTL_MS = 5 * 60_000;

/**
 * The device a claim is bound to, as it appears inside the claim: an HMAC of
 * the scan-device cookie (see scan-device.ts) under the session's secret.
 * Never the id itself, and unlinkable from one session to the next.
 */
export function claimDeviceTag(secret: string, deviceId: string): string {
  return createHmac('sha256', secret)
    .update(`device:${deviceId}`)
    .digest('base64url')
    .slice(0, 22);
}

function claimMac(
  secret: string,
  sessionId: string,
  exp: number,
  nonce: string,
  device: string,
): string {
  return createHmac('sha256', secret)
    .update(`claim:${sessionId}:${exp}:${nonce}:${device}`)
    .digest('base64url')
    .slice(0, 32);
}

/**
 * Trade a live QR token for something that lasts long enough to sign in.
 *
 * A student who scans while signed out spends longer than a QR window on the
 * login code, so the scan page swaps the token for this claim first. It does
 * not widen the window for passing the code on: getting a claim still needs a
 * token that is live right now, exactly as checking in directly does. Each
 * claim carries a random nonce so the server can redeem it only once, and is
 * bound to the device that scanned (its scan-device cookie), so a claim link
 * forwarded to a friend at home does not work on their phone.
 */
export function qrClaim(
  secret: string,
  sessionId: string,
  now: number,
  deviceId: string,
): {
  claim: string;
  expiresAt: number;
} {
  const exp = now + QR_CLAIM_TTL_MS;
  const nonce = randomBytes(16).toString('base64url');
  const device = claimDeviceTag(secret, deviceId);
  return {
    claim: `${exp}.${nonce}.${device}.${claimMac(secret, sessionId, exp, nonce, device)}`,
    expiresAt: exp,
  };
}

/**
 * Check a claim's signature and expiry. Returns its nonce, expiry and device
 * tag when valid (for single-use bookkeeping and the device check), otherwise
 * null. Does not check the device: see `claimFromDevice`.
 */
export function readQrClaim(
  secret: string,
  sessionId: string,
  claim: string,
  now: number,
): { nonce: string; expiresAt: number; device: string } | null {
  const [expPart, nonce, device, mac, extra] = claim.split('.');
  if (
    extra !== undefined ||
    !expPart ||
    !nonce ||
    !device ||
    !mac ||
    !/^\d+$/.test(expPart) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(device)
  ) {
    return null;
  }
  const exp = Number(expPart);
  if (exp < now || exp > now + QR_CLAIM_TTL_MS) return null;
  const expected = Buffer.from(
    claimMac(secret, sessionId, exp, nonce, device),
  );
  const given = Buffer.from(mac);
  const ok =
    expected.length === given.length && timingSafeEqual(expected, given);
  return ok ? { nonce, expiresAt: exp, device } : null;
}

/** Whether a valid claim's device tag is the one for this device cookie. */
export function claimFromDevice(
  secret: string,
  claimDevice: string,
  deviceId: string | undefined,
): boolean {
  if (!deviceId) return false;
  const expected = Buffer.from(claimDeviceTag(secret, deviceId));
  const given = Buffer.from(claimDevice);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A valid, unexpired claim presented from the device that got it. */
export function verifyQrClaim(
  secret: string,
  sessionId: string,
  claim: string,
  now: number,
  deviceId: string | undefined,
): boolean {
  const read = readQrClaim(secret, sessionId, claim, now);
  return !!read && claimFromDevice(secret, read.device, deviceId);
}
