/**
 * AUTH_SECRET keys the hashes of sign-in codes and signs short-lived tokens.
 * Required in production; development falls back to a fixed value so a fresh
 * checkout runs, and says so.
 */
let warned = false;

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be set (32+ characters) in production');
  }
  if (!warned) {
    warned = true;
    console.warn('AUTH_SECRET is not set; using an insecure development secret');
  }
  return 'development-only-auth-secret-do-not-use-in-production';
}

/**
 * DATA_ENCRYPTION_KEY (optional, 32+ characters) keys the secrets stored in
 * the database (webhook signing secrets and header values, school SSO client
 * secrets) and signs new erasure-log entries. Separate from AUTH_SECRET so
 * AUTH_SECRET can be rotated without losing them (see secret-box.ts and
 * scripts/reencrypt-secrets.ts). Null when unset: AUTH_SECRET is used, as
 * before. Set but shorter than 32 characters is a configuration error.
 */
export function dataEncryptionKey(): string | null {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (raw === undefined || raw === '') return null;
  if (raw.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be at least 32 characters when set');
  }
  return raw;
}
