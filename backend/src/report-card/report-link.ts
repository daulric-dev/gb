import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authSecret } from '@/account/secret';

/**
 * Short-lived signed download links for one stored report: whoever holds
 * the link can fetch that one PDF until it expires, without a session. Used
 * where the caller cannot attach the session (a browser tab, an email, the
 * parent portal later). The token names the document and its school and is
 * HMAC-SHA256 signed with a key derived from AUTH_SECRET; the document is
 * re-checked (still published, still ready, key inside the school) when the
 * link is used.
 *
 * The token travels in the URL path, so it ends up in proxy and CDN access
 * logs and in `Referer`. Each one therefore carries a random `jti` and is
 * single use: opening it records the id (`report_link_use`) and a second
 * attempt is refused, so a token recovered from a log is spent.
 */

export const REPORT_LINK_TTL_SECONDS = 5 * 60;

export interface ReportLinkClaims {
  /** report_document id */
  d: string;
  /** school id */
  s: string;
  /** expiry, seconds since the epoch */
  e: number;
  /** this link's own id: 128 random bits, recorded when the link is used */
  j: string;
}

function key(): Buffer {
  return createHmac('sha256', authSecret()).update('gradebook:report-card-link:v1').digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('base64url');
}

export function signReportLink(
  documentId: string,
  schoolId: string,
  now = Date.now(),
  ttlSeconds = REPORT_LINK_TTL_SECONDS,
): { token: string; expiresAt: Date } {
  const e = Math.floor(now / 1000) + ttlSeconds;
  const j = randomBytes(16).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ d: documentId, s: schoolId, e, j })).toString('base64url');
  return { token: `${payload}.${mac(payload)}`, expiresAt: new Date(e * 1000) };
}

/** The claims of a valid, unexpired token; null for anything else. */
export function verifyReportLink(token: string, now = Date.now()): ReportLinkClaims | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ReportLinkClaims;
    if (typeof claims.d !== 'string' || typeof claims.s !== 'string' || typeof claims.e !== 'number') return null;
    // Links signed before single use existed have no `j` and are refused
    // rather than let through unspendable; they last five minutes, so the
    // only ones in flight at a deploy are about to expire anyway.
    if (typeof claims.j !== 'string' || claims.j.length === 0) return null;
    if (claims.e * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}
