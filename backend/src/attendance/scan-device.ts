import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { authCookieSecure } from '@/config/origins';

/**
 * The scan-device cookie: a random id for the browser that scanned an
 * attendance QR while signed out. A scan claim is bound to (an HMAC of) it,
 * and redeeming the claim needs the same cookie, so a claim link forwarded to
 * another phone fails there.
 *
 * HttpOnly, so page script - and a student copying it out to a friend - never
 * sees it. Host-only on the API and SameSite=Lax: the web app calls the API
 * same-site with `credentials: "include"`, so it rides along on both the
 * claim and the check-in.
 */
export const SCAN_DEVICE_COOKIE = 'gb_scan_device';

/** A year: the id is not a credential, just a stable label for the device. */
const SCAN_DEVICE_MAX_AGE_S = 365 * 24 * 60 * 60;

const DEVICE_ID = /^[A-Za-z0-9_-]{22,64}$/;

/** 128 random bits. */
export function newScanDeviceId(): string {
  return randomBytes(16).toString('base64url');
}

/** The well-formed device id on a request, if any. */
export function scanDeviceIdFrom(req: {
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const value = req.cookies?.[SCAN_DEVICE_COOKIE];
  return value && DEVICE_ID.test(value) ? value : undefined;
}

/** Set (or refresh) the device cookie. */
export function setScanDeviceCookie(reply: FastifyReply, deviceId: string): void {
  reply.setCookie(SCAN_DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: 'lax',
    path: '/api',
    maxAge: SCAN_DEVICE_MAX_AGE_S,
  });
}
