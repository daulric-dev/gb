import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as oidc from 'openid-client';
import { emailDomainOf } from '../sso.config';
import type {
  SsoClientContext,
  SsoCompleteContext,
  SsoDomainContext,
  SsoIdentity,
  SsoProviderConfig,
  SsoSettingField,
  SsoStartContext,
} from '../sso.types';
import {
  safeWebhookFetch,
  type FetchLike,
} from '@/integrations/delivery/webhook-sender';
import { resolveWebhookDestinations } from '@/integrations/delivery/webhook-destination';
import { claimString } from './profile';
import { OidcAdapter, type OidcDiscoverySetup } from './oidc.adapter';

export const CUSTOM_OIDC_ID = 'oidc';

/** The claims an address may be read from. `email` is the default. */
export const EMAIL_CLAIMS = ['email', 'preferred_username', 'upn'] as const;
export type EmailClaim = (typeof EMAIL_CLAIMS)[number];

const DISPLAY_NAME_MAX = 60;
const MAX_EXTRA_SCOPES = 10;
/** RFC 6749 scope-token: printable ASCII but space, `"` and `\`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]{1,100}$/;
const BASE_SCOPES = ['openid', 'email', 'profile'];
/** Discovery documents, JWKS and token responses are small. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
const WELL_KNOWN = '/.well-known/openid-configuration';

/** Shown on the button when the school gave no name. */
const DEFAULT_LABEL = 'your school account';

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

/**
 * An issuer URL as stored: http(s), no user name or password, no query or
 * fragment, a pasted discovery URL cut back to its issuer. Null when it is
 * not one. Whether http is allowed is decided with the private-network
 * setting (`checkIssuer`).
 */
export function normalizeIssuer(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname || url.username || url.password) return null;
  if (url.search || url.hash || value.includes('#')) return null;
  if (url.pathname.endsWith(WELL_KNOWN)) {
    url.pathname = url.pathname.slice(0, -WELL_KNOWN.length) || '/';
  }
  // The root path is written without its slash ("https://id.example.edu"),
  // as most providers state their issuer; the comparison ignores it.
  return url.pathname === '/' ? url.origin : url.href;
}

/**
 * Whether two issuer identifiers are the same, the way openid-client
 * compares the discovered issuer with the one asked for (URL-normalised:
 * a bare origin equals the origin with "/").
 */
export function sameIssuer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

const allowsPrivate = (settings: Record<string, string>) =>
  settings.allowPrivateNetwork === 'true';

/** The configured email claim (`email` unless set). */
export function emailClaimOf(settings: Record<string, string>): EmailClaim {
  const claim = settings.emailClaim as EmailClaim | undefined;
  return claim && EMAIL_CLAIMS.includes(claim) ? claim : 'email';
}

/**
 * The issuer a school configured, if it is usable: normalised, and https
 * unless the school marked it as on its private network.
 */
function issuerOf(settings: Record<string, string>): string | null {
  const issuer = normalizeIssuer(settings.issuer);
  if (!issuer) return null;
  if (issuer.startsWith('http:') && !allowsPrivate(settings)) return null;
  return issuer;
}

/** `school:<id>` -> the id; null for the env client (never used here). */
function schoolOf(clientKey: string): string | null {
  return clientKey.startsWith('school:') ? clientKey.slice('school:'.length) || null : null;
}

function bodyString(body: oidc.CustomFetchOptions['body']): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return Buffer.from(body as ArrayBuffer).toString('utf8');
  }
  throw new Error('Unsupported request body');
}

async function cappedBody(res: Response, limit: number): Promise<Response> {
  if (!res.body) return res;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => undefined);
      throw new Error('The identity provider sent too large a response');
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * openid-client's fetch for one school's issuer: every request (discovery,
 * JWKS, token) goes through the webhook sender's `safeWebhookFetch`, which
 * resolves the host per request, refuses private / loopback / link-local /
 * reserved addresses unless `allowPrivate`, pins the checked address to the
 * connection (no DNS rebinding) and never follows redirects. https only
 * unless `allowPrivate`; no credentials in URLs; 1 MB per response.
 */
export function issuerFetch(transport: FetchLike, allowPrivate: boolean): oidc.CustomFetch {
  return async (raw, options) => {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
      throw new Error('The identity provider must use https');
    }
    if (url.username || url.password) {
      throw new Error('The identity provider URL must not contain credentials');
    }
    const res = await transport(url.href, {
      method: options.method,
      headers: options.headers,
      body: bodyString(options.body),
      redirect: 'manual',
      signal: options.signal,
      // Explicit: WEBHOOK_ALLOW_PRIVATE never applies to sign-in.
      allowPrivate,
    });
    return cappedBody(res, MAX_RESPONSE_BYTES);
  };
}

/**
 * Any OpenID Connect identity provider a school runs or subscribes to -
 * Keycloak, Authentik, Okta, Auth0, Ping, a home-built one. Configured
 * entirely per school on its `school_sso_provider` row (no env fallback):
 * client ID and secret like Google and Microsoft, plus the issuer, the
 * button text, which claim holds the address and extra scopes.
 *
 * The issuer is admin-entered and fetched by the server, so every request
 * goes through `issuerFetch` (public addresses only unless the school says
 * the IdP is on its private network, address pinned, no redirects).
 *
 * Vouching: only for a domain of the school whose issuer signed the ID
 * token (openid-client checks `iss` against the discovered issuer, and the
 * adapter checks it against the configured one), for an address on that
 * domain, and - from the `email` claim - only with `email_verified: true`.
 * An address from `preferred_username` / `upn` (not promised to be a real
 * mailbox) vouches only for domains explicitly set to this provider.
 * Subjects are namespaced `<schoolId>:<issuer hash>:<sub>`, so two schools'
 * IdPs (or one school's old and new IdP) never share an identity.
 */
export class CustomOidcAdapter extends OidcAdapter {
  readonly settingFields: readonly SsoSettingField[] = [
    {
      key: 'displayName',
      label: 'Button name',
      description: `What the sign-in button says: "Continue with <name>" (at most ${DISPLAY_NAME_MAX} characters).`,
      placeholder: 'Riverside ID',
    },
    {
      key: 'issuer',
      label: 'Issuer URL',
      description:
        'Your identity provider\'s issuer. Its discovery document must be at <issuer>/.well-known/openid-configuration.',
      placeholder: 'https://id.riverside.edu/realms/students',
      type: 'url',
    },
    {
      key: 'emailClaim',
      label: 'Email claim',
      description:
        'Which ID token claim holds the user\'s school address. With "email", the provider must also send email_verified: true. The others only place people in your school on domains set to this provider.',
      type: 'select',
      options: [
        { value: 'email', label: 'email (verified)' },
        { value: 'preferred_username', label: 'preferred_username' },
        { value: 'upn', label: 'upn' },
      ],
    },
    {
      key: 'scope',
      label: 'Extra scopes',
      description: 'Requested on top of "openid email profile", separated by spaces. Usually empty.',
      placeholder: 'groups',
    },
    {
      key: 'allowPrivateNetwork',
      label: 'Identity provider is on our private network',
      description:
        'For an on-premises identity provider: lets the issuer use http or resolve to a private address.',
      type: 'switch',
      warning:
        'Only turn this on for an identity provider your school runs on its own network. It lets GradeBook\'s server contact private addresses at the issuer URL you enter.',
    },
  ];

  constructor(
    private readonly transport: FetchLike = safeWebhookFetch,
    private readonly resolver?: Resolver,
  ) {
    super({
      id: CUSTOM_OIDC_ID,
      label: DEFAULT_LABEL,
      adminLabel: 'Custom OpenID Connect',
      // Never read: a custom provider has no install-wide app.
      clientIdEnv: '',
      clientSecretEnv: '',
      adminNotes:
        'Any OpenID Connect identity provider (Keycloak, Authentik, Okta, Auth0, your own). Register a confidential "web" client with the redirect URI below and the authorization code flow, paste its client ID and secret here, enter the issuer URL and a button name, then pick this provider on your email domains.',
    });
  }

  /** Nothing install-wide: each school brings its own identity provider. */
  envConfig(): SsoProviderConfig {
    return { enabled: false, clientId: null, clientSecret: null, settings: {} };
  }

  available(config: SsoProviderConfig): boolean {
    return super.available(config) && !!issuerOf(config.settings);
  }

  labelFor(config: SsoProviderConfig): string {
    return config.settings.displayName?.trim() || this.label;
  }

  normalizeSetting(key: string, value: string): string {
    const v = value.trim();
    switch (key) {
      case 'displayName': {
        const name = v.replace(/\s+/g, ' ');
        if ([...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
          throw new BadRequestException('The button name cannot contain control characters');
        }
        if (name.length > DISPLAY_NAME_MAX) {
          throw new BadRequestException(
            `The button name must be at most ${DISPLAY_NAME_MAX} characters`,
          );
        }
        return name;
      }
      case 'issuer': {
        const issuer = normalizeIssuer(v);
        if (!issuer) {
          throw new BadRequestException(
            'The issuer must be an https:// URL without a user name, password, query or fragment',
          );
        }
        return issuer;
      }
      case 'emailClaim':
        if (!(EMAIL_CLAIMS as readonly string[]).includes(v)) {
          throw new BadRequestException(
            `The email claim must be one of ${EMAIL_CLAIMS.join(', ')}`,
          );
        }
        return v === 'email' ? '' : v;
      case 'scope': {
        const tokens = [...new Set(v.split(/\s+/).filter(Boolean))].filter(
          (t) => !BASE_SCOPES.includes(t),
        );
        if (tokens.some((t) => !SCOPE_TOKEN.test(t))) {
          throw new BadRequestException('Scopes are words separated by spaces');
        }
        if (tokens.length > MAX_EXTRA_SCOPES) {
          throw new BadRequestException(`At most ${MAX_EXTRA_SCOPES} extra scopes`);
        }
        return tokens.join(' ');
      }
      case 'allowPrivateNetwork':
        if (v !== 'true' && v !== 'false') {
          throw new BadRequestException('allowPrivateNetwork is "true" or "false"');
        }
        return v === 'true' ? 'true' : '';
      default:
        return v;
    }
  }

  /**
   * The issuer as a whole: https unless on the private network, and every
   * address its host resolves to public unless on the private network. A
   * provider cannot be turned on without one.
   */
  async checkSettings(settings: Record<string, string>, enabled: boolean): Promise<void> {
    const raw = settings.issuer;
    if (!raw) {
      if (enabled) {
        throw new BadRequestException('Add the issuer URL before turning it on');
      }
      return;
    }
    const issuer = normalizeIssuer(raw);
    const allowPrivate = allowsPrivate(settings);
    if (!issuer) throw new BadRequestException('The issuer URL is not valid');
    if (issuer.startsWith('http:') && !allowPrivate) {
      throw new BadRequestException(
        'The issuer must use https (http only for an identity provider on your private network)',
      );
    }
    try {
      await resolveWebhookDestinations(new URL(issuer).hostname, this.resolver, {
        allowPrivate,
      });
    } catch (err) {
      const message = (err as Error).message;
      throw new BadRequestException(
        /private or reserved/.test(message)
          ? 'The issuer resolves to a private or reserved address. Turn on "Identity provider is on our private network" only if it runs on your own network.'
          : 'The issuer\'s host name could not be resolved',
      );
    }
  }

  protected discoverySetup(ctx: SsoClientContext): OidcDiscoverySetup {
    const allowPrivate = allowsPrivate(ctx.config.settings);
    return {
      key: allowPrivate ? 'private' : 'public',
      options: {
        [oidc.customFetch]: issuerFetch(this.transport, allowPrivate),
        execute: [
          // openid-client skips the ID token's signature for token endpoint
          // responses (TLS stands in for it). The endpoint here comes from
          // an admin-chosen discovery document, possibly over plain http on
          // a private network, so the signature is checked against the
          // issuer's JWKS too.
          oidc.enableNonRepudiationChecks,
          ...(allowPrivate ? [oidc.allowInsecureRequests] : []),
        ],
      },
    };
  }

  protected issuerFor(ctx: SsoStartContext): string {
    if (!schoolOf(ctx.clientKey)) {
      throw new BadRequestException('Enter your school email to sign in');
    }
    const issuer = issuerOf(ctx.config.settings);
    if (!issuer) {
      throw new BadRequestException('Your school has not finished setting up its sign-in');
    }
    return issuer;
  }

  protected scopeFor(ctx: SsoStartContext): string {
    const extra = ctx.config.settings.scope?.split(/\s+/).filter(Boolean) ?? [];
    return [...new Set([...BASE_SCOPES, ...extra])].join(' ');
  }

  protected authorizationParams(ctx: SsoStartContext): Record<string, string> {
    return ctx.email ? { login_hint: ctx.email } : {};
  }

  async complete(ctx: SsoCompleteContext): Promise<SsoIdentity> {
    const schoolId = schoolOf(ctx.clientKey);
    const issuer = issuerOf(ctx.config.settings);
    if (!schoolId || !issuer) throw new Error('Custom OpenID Connect needs a school\'s own configuration');
    // The school changed its issuer since this sign-in started.
    if (!sameIssuer(ctx.secrets.issuer, issuer)) {
      throw new Error('The identity provider changed during sign-in');
    }
    const claims = await this.verifiedClaims(ctx);
    // openid-client already held `iss` to the discovered issuer, which it
    // held to this one; checked again so nothing else can slip through.
    if (!sameIssuer(claimString(claims, 'iss'), issuer)) {
      throw new Error('Unexpected issuer');
    }
    return this.schoolIdentity(claims, schoolId, issuer, emailClaimOf(ctx.config.settings));
  }

  /** Our identity from claims verified under `schoolId`'s issuer. */
  schoolIdentity(
    claims: Record<string, unknown>,
    schoolId: string,
    issuer: string,
    emailClaim: EmailClaim,
  ): SsoIdentity {
    const sub = claimString(claims, 'sub');
    if (!sub) throw new Error('ID token without a subject');
    const raw = claimString(claims, emailClaim);
    const email = raw && emailDomainOf(raw) ? raw.toLowerCase() : null;
    const issuerHash = createHash('sha256').update(new URL(issuer).href).digest('hex').slice(0, 16);
    return {
      provider: this.id,
      // Namespaced by school and issuer: another school's IdP (or this
      // school's previous one) can never assert a subject that is not its own.
      subject: `${schoolId}:${issuerHash}:${sub}`,
      email,
      emailVerified: emailClaim === 'email' && claims.email_verified === true,
      claims,
      profile: this.profileFrom(claims),
      verifiedForSchool: schoolId,
      emailClaim,
    };
  }

  vouchesForDomain(identity: SsoIdentity, ctx: SsoDomainContext): boolean {
    if (identity.provider !== this.id) return false;
    // Only the school whose own issuer checked the token.
    if (!identity.verifiedForSchool || !ctx.schoolId) return false;
    if (identity.verifiedForSchool !== ctx.schoolId) return false;
    if (emailDomainOf(identity.email) !== ctx.domain) return false;
    if ((identity.emailClaim ?? 'email') === 'email') return identity.emailVerified;
    // A sign-in name is not promised to be a mailbox: only a domain the
    // school pointed at this provider takes it as one (like SAML, where the
    // domain's own configuration is what vouches).
    return ctx.ssoProvider === this.id;
  }

  /**
   * Never on its own: a school's IdP may say anything about addresses
   * outside its domains (a Gmail address included), so an address is only
   * trusted when `vouchesForDomain` says so for that school's domain.
   */
  verifiesEmail(): boolean {
    return false;
  }
}
