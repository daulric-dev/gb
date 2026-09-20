/**
 * The Storage address to hand a client for a direct (TUS) upload.
 *
 * The backend talks to Supabase over `SUPABASE_URL`, which in development is
 * `127.0.0.1` - the backend's own machine, and meaningless to a phone. The
 * client needs an address it can route to, and the one it demonstrably can
 * route to is the one it just reached this process on.
 *
 * So the host is taken from the request and the Supabase port kept, unless
 * SUPABASE_PUBLIC_URL says otherwise. That survives the machine changing
 * address, which a hardcoded LAN IP does not.
 */

export function storagePublicUrl(requestHost?: string): string {
  const configured = process.env.SUPABASE_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');

  const internal = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');

  // A hosted project is reachable by the same URL from everywhere.
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(internal)) {
    return internal;
  }

  const host = requestHost?.split(':')[0];
  if (!host) return internal;

  try {
    const url = new URL(internal);
    url.hostname = host;
    return url.origin;
  } catch {
    return internal;
  }
}
