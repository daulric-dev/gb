import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import {
  isIssuedSessionToken,
  sessionTokenFrom,
} from '@/account/session.service';

export type ThrottlerReq = {
  /** Read before validation, so anything may be in it. */
  body?: { email?: unknown } | null;
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

/**
 * Sign-in attempts for one address from one client address. Keyed on both so
 * someone guessing (or asking for codes) for a victim's address only uses up
 * their own budget, never the victim's. The body has not been validated yet,
 * so a non-string `email` just falls back to the client address.
 */
export function getEmailIpTracker(req: ThrottlerReq): string {
  const ip = `ip:${getClientIp(req) ?? 'unknown'}`;
  const email = req.body?.email;
  if (typeof email !== 'string' || !email.trim()) return ip;
  return `e:${fingerprint(email.trim().toLowerCase())}|${ip}`;
}

/** Metadata key `@Throttle()` stores a throttler's limit under (`@nestjs/throttler`). */
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

/**
 * A `skipIf` for a named throttler that only applies where a route (or its
 * controller) names it in `@Throttle()`. Per-IP sign-in limits belong on the
 * sign-in routes; applied everywhere they would throttle a whole school
 * behind one NAT address.
 */
export function skipUnlessDeclared(name: string) {
  return (context: ExecutionContext): boolean => {
    const targets = [context.getHandler?.(), context.getClass?.()];
    return !targets.some(
      (target) => target && Reflect.getMetadata(THROTTLER_LIMIT + name, target) !== undefined,
    );
  };
}
