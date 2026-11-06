import { parse as parseQueryString } from 'node:querystring';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { allowedOrigins, isDevelopmentOrigin } from '@/config/origins';
import { NATIVE_CLIENT_HEADER, sessionTokenVia } from '@/account/session.service';
import { QUERY_METHOD } from './http-query';

/**
 * Cross-site request forgery protection for the session cookie.
 *
 * The `gb_session` cookie is SameSite=Lax on the parent domain, so a page on
 * any sibling subdomain is "same-site" and its form posts carry the cookie.
 * Every state-changing request that would be authenticated by that cookie
 * must therefore come from one of our own origins (FRONTEND_URL), which
 * browsers state in `Origin` (or, failing that, `Referer`).
 *
 * Not checked:
 * - safe methods (GET, HEAD, OPTIONS, and QUERY - a read with a JSON body);
 * - requests with no session cookie: there is no ambient authority to abuse;
 * - the native app, which authenticates with `Authorization: Bearer` and
 *   identifies itself with `X-GradeBook-Client`. Both are custom headers a
 *   cross-site page cannot send without a CORS preflight, which only our
 *   origins pass;
 * - the SAML assertion consumer service, which an identity provider on
 *   another site posts to by design. It does not act on the session cookie:
 *   it verifies the signed assertion and starts a new session from it.
 *
 * There are no inbound webhooks; integrations only send them.
 */

/** The SAML ACS route: the only cross-site form post the API accepts. */
export const SAML_ACS_PATH = '/api/auth/sso/saml/acs';

/** Routes exempt from the origin check (see above). */
export const CSRF_EXEMPT_PATHS: ReadonlySet<string> = new Set([SAML_ACS_PATH]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', QUERY_METHOD]);

export const CSRF_REJECTION_MESSAGE = 'This request did not come from GradeBook. Reload the page and try again';

type CsrfRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
};

/** The path of a request URL: no query string, no trailing slash. */
export function requestPath(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function header(req: CsrfRequest, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/** The origin the browser says the request came from: Origin, else Referer's. */
export function requestSourceOrigin(req: CsrfRequest): string | undefined {
  const origin = header(req, 'origin');
  // "null" is what sandboxed frames and privacy-sensitive redirects send:
  // present, but not one of ours.
  if (origin) return origin;
  const referer = header(req, 'referer');
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function isTrustedOrigin(origin: string): boolean {
  return allowedOrigins().includes(origin) || isDevelopmentOrigin(origin);
}

/**
 * Why this request must be refused as a possible forgery, or null when it may
 * go ahead. Pure, so the rules can be tested without a server.
 */
export function csrfViolation(req: CsrfRequest): string | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  if (CSRF_EXEMPT_PATHS.has(requestPath(req.url))) return null;
  if (header(req, NATIVE_CLIENT_HEADER) === 'native') return null;
  if (sessionTokenVia(req) !== 'cookie') return null;

  const origin = requestSourceOrigin(req);
  if (!origin) return 'missing origin';
  if (!isTrustedOrigin(origin)) return `untrusted origin ${origin}`;
  return null;
}

/**
 * Install the check as an `onRequest` hook: it runs before the body is parsed
 * and before any guard, so a forged request does no work at all. Register it
 * after `@fastify/cookie`, whose own `onRequest` hook fills `request.cookies`.
 */
export function registerCsrfProtection(instance: FastifyInstance): void {
  instance.addHook(
    'onRequest',
    (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      const violation = csrfViolation(request);
      if (!violation) {
        done();
        return;
      }
      request.log.warn(
        { method: request.method, url: requestPath(request.url) },
        `Refused a cookie-authenticated request: ${violation}`,
      );
      void reply.code(403).send({
        statusCode: 403,
        message: CSRF_REJECTION_MESSAGE,
        error: 'Forbidden',
      });
    },
  );
}

/**
 * The `application/x-www-form-urlencoded` parser. Only the SAML ACS route
 * takes a form body (the IdP's auto-submitting form); everywhere else it is
 * refused with 415, so a plain HTML form - which needs no CORS preflight -
 * cannot reach a JSON endpoint at all.
 */
export function formBodyParser(
  request: { url: string },
  body: Buffer,
  done: (err: Error | null, body?: unknown) => void,
): void {
  if (requestPath(request.url) !== SAML_ACS_PATH) {
    done(
      new UnsupportedMediaTypeException(
        'Form bodies are not accepted here; send JSON',
      ),
    );
    return;
  }
  done(null, parseQueryString(body.toString()));
}

/**
 * Register the app's body parsers in place of Nest's defaults (registering
 * any of them marks Nest's as done): JSON exactly as Nest would, and form
 * bodies through `formBodyParser`. Call before `app.init()`.
 */
export function useBodyParsers(app: NestFastifyApplication): void {
  const instance = app.getHttpAdapter().getInstance();
  const { bodyLimit, onProtoPoisoning, onConstructorPoisoning } =
    instance.initialConfig;
  const jsonParser = instance.getDefaultJsonParser(
    onProtoPoisoning ?? 'error',
    onConstructorPoisoning ?? 'error',
  );
  app.useBodyParser('application/json', { bodyLimit }, (req, body, done) =>
    // As Nest's own parser does: the raw buffer goes to Fastify's JSON parser.
    jsonParser(
      req as Parameters<typeof jsonParser>[0],
      body as unknown as string,
      done,
    ),
  );
  app.useBodyParser(
    'application/x-www-form-urlencoded',
    { bodyLimit },
    formBodyParser,
  );
}
