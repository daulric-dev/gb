import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
 * The verified user id carried by an HS256 Supabase JWT, or undefined.
 *
 * The throttler runs before AuthGuard, so an unverified token would let a
 * client rotate random "Bearer" values to get a fresh bucket per request.
 */
export function verifiedSubject(
  token: string,
  secret: string | undefined = process.env.SUPABASE_JWT_SECRET,
  now: number = Math.floor(Date.now() / 1000),
): string | undefined {
  if (!secret) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts;

  try {
    const { alg } = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (alg !== 'HS256') return undefined;

    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return undefined;
    }

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof claims.exp === 'number' && claims.exp < now) return undefined;
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : undefined;
  } catch {
    return undefined;
  }
}

/** The access token inside an @supabase/ssr auth cookie (possibly chunked). */
export function accessTokenFromCookies(
  cookies: Record<string, string | undefined>,
): string | undefined {
  const chunks = new Map<string, { index: number; value: string }[]>();
  for (const [name, value] of Object.entries(cookies)) {
    const match = name.match(/^(sb-.+-auth-token)(?:\.(\d+))?$/);
    if (!match || !value) continue;
    const list = chunks.get(match[1]) ?? [];
    list.push({ index: match[2] ? Number(match[2]) : -1, value });
    chunks.set(match[1], list);
  }

  for (const list of chunks.values()) {
    const raw = list
      .sort((a, b) => a.index - b.index)
      .map((c) => c.value)
      .join('');
    try {
      const json = raw.startsWith('base64-')
        ? Buffer.from(raw.slice('base64-'.length), 'base64url').toString()
        : decodeURIComponent(raw);
      const session = JSON.parse(json);
      const token = Array.isArray(session) ? session[0] : session?.access_token;
      if (typeof token === 'string' && token) return token;
    } catch {
      // Not a session cookie we understand; try the next one.
    }
  }
  return undefined;
}

export function getSessionTracker(req: ThrottlerReq): string | undefined {
  let token: string | undefined;

  const auth = req.headers?.['authorization'];
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) token = match[1].trim();
  }
  if (!token && req.cookies) token = accessTokenFromCookies(req.cookies);
  if (!token) return undefined;

  const sub = verifiedSubject(token);
  return sub ? `u:${fingerprint(sub)}` : undefined;
}
