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
/**
 * The `Domain` attribute for the auth cookie in production, or `undefined` for
 * a host-only cookie.
 *
 * It cannot simply be the API's own host: the web app's middleware reads this
 * cookie on the *frontend's* domain to decide redirects, so the cookie has to
 * be visible to both. The default derives a shared parent from the canonical
 * origin, which is right when the API and the app are subdomains of one
 * two-label domain.
 *
 * `AUTH_COOKIE_DOMAIN` overrides it, and is needed when that assumption does
 * not hold:
 *
 *   - the API is on a different registrable domain from the app, where the
 *     derived value makes the browser reject the cookie outright;
 *   - the domain has a multi-part suffix (`app.example.co.uk` derives
 *     `.co.uk`, a public suffix every browser refuses).
 *
 * Set it to `none` for a host-only cookie - correct when the app and API share
 * one host, and for a native client, which has no frontend domain at all.
 */
export function authCookieDomain(): string | undefined {
  if (process.env.NODE_ENV !== 'production') return undefined;

  const configured = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (configured) {
    return configured.toLowerCase() === 'none' ? undefined : configured;
  }

  try {
    const { hostname } = new URL(primaryOrigin());
    return `.${hostname.split('.').slice(-2).join('.')}`;
  } catch {
    return undefined;
  }
}

export function isOriginAllowed(origin?: string | null): boolean {
  // No Origin header: same-origin, curl, or a native app. Nothing to check.
  if (!origin) return true;

  return allowedOrigins().includes(origin) || isDevelopmentOrigin(origin);
}
