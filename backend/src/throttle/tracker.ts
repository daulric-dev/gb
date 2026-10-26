import { createHash } from 'node:crypto';
import {
  isIssuedSessionToken,
  sessionTokenFrom,
} from '@/account/session.service';

export type ThrottlerReq = {
  body?: { email?: string };
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
};

/**
 * The client address, as resolved by Fastify.
 *
 * Proxy headers are deliberately not read here: X-Real-IP and X-Forwarded-For
 * are client-controlled unless a trusted proxy overwrote them, and only the
 * server knows how many proxies sit in front of it. Fastify's `trustProxy`
 * (see TRUST_PROXY_HOPS in createApp) already walks X-Forwarded-For that many
 * hops from the right and puts the result in `req.ip`.
 */
export function getClientIp(req: ThrottlerReq): string | undefined {
  return req.ip || undefined;
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

/**
 * One bucket per signed-in session, keyed on the `gb_session` cookie (or the
 * mobile app's bearer token).
 *
 * The throttler runs before AuthGuard, so only tokens this server issued
 * count (checked by their tag, without a database lookup); otherwise a client
 * could rotate made-up cookie values to get a fresh bucket per request. The
 * key is a fingerprint, never the token itself.
 */
export function getSessionTracker(req: ThrottlerReq): string | undefined {
  const token = sessionTokenFrom(req);
  return isIssuedSessionToken(token) ? `s:${fingerprint(token)}` : undefined;
}
