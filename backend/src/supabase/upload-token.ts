import { createHmac } from 'node:crypto';

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
