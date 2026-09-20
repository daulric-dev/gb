/**
 * The browser origins allowed to call this API.
 *
 * FRONTEND_URL holds a comma-separated list because the web app is no longer
 * the only browser client: the mobile app served over Expo web arrives from
 * its own origin, and a developer's LAN address is different again. Native
 * React Native sends no Origin header at all, so none of this applies there.
 *
 * Everything that needs an origin goes through here, because several callers
 * write the CORS header by hand and one derives the cookie domain from it -
 * and a raw list would be an invalid value for either.
 */

const DEFAULT_ORIGIN = 'http://localhost:3000';

/**
 * Anything on this machine or the local network, which is where a phone
 * running the app over Expo web comes from. The address changes with the DHCP
 * lease, so it is matched by shape rather than listed.
 */
const PRIVATE_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+)(:\d+)?$/;

/** Dev only: a LAN origin is trusted because the network already is. */
function isDevelopmentOrigin(origin: string): boolean {
  return process.env.NODE_ENV !== 'production' && PRIVATE_ORIGIN.test(origin);
}

export function allowedOrigins(): string[] {
  const configured = (process.env.FRONTEND_URL || DEFAULT_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : [DEFAULT_ORIGIN];
}

/**
 * The canonical origin: the first configured one. Used where a single value is
 * required, such as the cookie domain, which cannot vary per request.
 */
export function primaryOrigin(): string {
  return allowedOrigins()[0];
}

/**
 * What to put in `Access-Control-Allow-Origin` for one request.
 *
 * The header takes a single origin when credentials are involved, so the
 * caller's own origin is echoed back when it is allowed, and the canonical one
 * is used otherwise.
 */
export function corsOriginFor(requestOrigin?: string | null): string {
  if (
    requestOrigin &&
    (allowedOrigins().includes(requestOrigin) ||
      isDevelopmentOrigin(requestOrigin))
  ) {
    return requestOrigin;
  }
  return primaryOrigin();
}

/**
 * The `origin` option for `enableCors`, as a function so development can
 * accept LAN addresses without them being listed.
 */
export function isOriginAllowed(origin?: string | null): boolean {
  // No Origin header: same-origin, curl, or a native app. Nothing to check.
  if (!origin) return true;

  return allowedOrigins().includes(origin) || isDevelopmentOrigin(origin);
}
