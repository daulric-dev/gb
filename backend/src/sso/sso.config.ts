import type { FastifyRequest } from 'fastify';

/** SSO_PROVIDERS=google,azure,saml - the adapters this deployment turns on. */
export function enabledProviders(): Set<string> {
  return new Set(
    (process.env.SSO_PROVIDERS ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The API's public origin. Providers must see the same redirect URL at start
 * and at the callback, so API_URL should be set wherever SSO is on; the
 * request's host is only a fallback for local runs.
 */
export function apiBase(req?: FastifyRequest): string {
  const configured = process.env.API_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (req) return `${req.protocol}://${req.headers.host as string}`;
  return 'http://localhost:3001';
}

/** Where OpenID Connect providers send the browser back. */
export function oidcRedirectUri(req?: FastifyRequest): string {
  return `${apiBase(req)}/api/auth/sso/callback`;
}

/** Where SAML identity providers post assertions. */
export function samlAcsUrl(req?: FastifyRequest): string {
  return `${apiBase(req)}/api/auth/sso/saml/acs`;
}

/** Our SAML entity ID; defaults to the metadata URL. */
export function samlEntityId(req?: FastifyRequest): string {
  return (
    process.env.SAML_SP_ENTITY_ID?.trim() ||
    `${apiBase(req)}/api/auth/sso/saml/metadata`
  );
}

/** The domain part of an address, lower-cased. */
export function emailDomainOf(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase() ?? '';
  const at = value.lastIndexOf('@');
  return at > 0 && at < value.length - 1 ? value.slice(at + 1) : null;
}
