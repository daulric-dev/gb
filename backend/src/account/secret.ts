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
