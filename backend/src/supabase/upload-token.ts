import { createHmac } from 'node:crypto';

/**
 * A short-lived Supabase session token, minted so a browser can upload
 * straight to Storage over TUS.
 *
 * The browser never holds a Supabase session of its own - this app's auth is
 * httpOnly cookies against the backend - and Storage's resumable endpoint
 * refuses signed upload tokens, so the backend mints one on demand. The token
 * is deliberately weak:
 *
 *   - it lasts minutes, not the life of a session;
 *   - it carries the caller's own id, so `get_user_school_id()` resolves to
 *     their school and the storage RLS policy confines writes to that prefix;
 *   - it is issued only after the caller has passed the usual permission guard.
 *
 * It is still a real `authenticated` token for its lifetime, so it must only
 * ever be handed to the user it was minted for, over the same TLS the rest of
 * the API uses.
 */

const b64url = (input: Buffer | string): string =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export interface UploadTokenOptions {
  /** The auth user the token speaks for. */
  userId: string;
  /** Seconds until it expires. Keep this short. */
  ttlSeconds: number;
  secret: string;
}

export function mintUploadToken({
  userId,
  ttlSeconds,
  secret,
}: UploadTokenOptions): { token: string; expiresAt: string } {
  if (!secret) {
    throw new Error('SUPABASE_JWT_SECRET is not set');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      role: 'authenticated',
      aud: 'authenticated',
      iat: issuedAt,
      exp: expiresAt,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signature = b64url(
    createHmac('sha256', secret).update(signingInput).digest(),
  );

  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}
