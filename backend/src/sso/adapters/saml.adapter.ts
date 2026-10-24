import { BadRequestException } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import {
  SAML,
  ValidateInResponseTo,
  generateServiceProviderMetadata,
  type CacheProvider,
  type Profile,
} from '@node-saml/node-saml';
import {
  emailDomainOf,
  enabledProviders,
  samlAcsUrl,
  samlEntityId,
} from '../sso.config';
import type {
  SsoAdapter,
  SsoCompleteContext,
  SsoDomainConfig,
  SsoDomainContext,
  SsoIdentity,
  SsoProfile,
  SsoStart,
  SsoStartContext,
} from '../sso.types';
import { claimString, standardProfile } from './profile';

const CLAIMS = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';
const MS_CLAIMS = 'http://schemas.microsoft.com/identity/claims';

const EMAIL_ATTRS = [
  'email',
  'mail',
  'emailAddress',
  'Email',
  'urn:oid:0.9.2342.19200300.100.1.3',
  `${CLAIMS}/emailaddress`,
  `${CLAIMS}/upn`,
  `${CLAIMS}/name`,
];
const FIRST_ATTRS = [
  'givenName',
  'given_name',
  'firstName',
  'FirstName',
  'urn:oid:2.5.4.42',
  `${CLAIMS}/givenname`,
];
const LAST_ATTRS = [
  'surname',
  'sn',
  'family_name',
  'lastName',
  'LastName',
  'urn:oid:2.5.4.4',
  `${CLAIMS}/surname`,
];
const FULL_ATTRS = [
  'displayName',
  'name',
  'urn:oid:2.16.840.1.113730.3.1.241',
  `${MS_CLAIMS}/displayname`,
];

/** How long an AuthnRequest may wait for its response. */
const REQUEST_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

/**
 * An IdP signing certificate as PEM, from a PEM block or the bare base64 body
 * many IdPs show, or null when it does not parse as X.509.
 */
export function normalizeCertificate(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const body = raw
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  try {
    new X509Certificate(pem);
    return pem;
  } catch {
    return null;
  }
}

/**
 * SAML 2.0 with any identity provider - ADFS, Okta, ClassLink, Google
 * Workspace SAML, Entra ID SAML, Shibboleth.
 *
 * Each school connects its own IdP from the email domain admin page (SSO
 * URL, IdP entity ID, signing certificate); there is no platform operator
 * step. Sign-in is SP-initiated: we send an (unsigned) AuthnRequest
 * with RelayState = our state, and accept at the ACS only a response to that
 * request whose assertion is signed by that school's certificate, issued by
 * its configured entity ID, for our audience, within its validity window.
 *
 * A SAML sign-in vouches for exactly the domain whose configuration
 * verified it, and only for addresses on that domain.
 */
export class SamlAdapter implements SsoAdapter {
  readonly id = 'saml';
  readonly label = 'your school (SSO)';
  readonly kind = 'saml' as const;

  isEnabled(): boolean {
    return enabledProviders().has(this.id);
  }

  readyFor(domain: SsoDomainConfig): boolean {
    return (
      !!domain.samlEntryPoint?.trim() &&
      !!domain.samlIssuer?.trim() &&
      !!domain.samlCertificate?.trim()
    );
  }

  /** A node-saml instance for one school's IdP. */
  private client(domain: SsoDomainConfig, cacheProvider: CacheProvider): SAML {
    const cert = normalizeCertificate(domain.samlCertificate);
    if (!cert) throw new Error(`Invalid SAML certificate on ${domain.domain}`);
    return new SAML({
      entryPoint: domain.samlEntryPoint!.trim(),
      issuer: samlEntityId(),
      callbackUrl: samlAcsUrl(),
      audience: samlEntityId(),
      idpCert: cert,
      idpIssuer: domain.samlIssuer!.trim(),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      acceptedClockSkewMs: CLOCK_SKEW_MS,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: REQUEST_TTL_MS,
      cacheProvider,
      // Let the IdP pick its NameID format, and do not demand password
      // authentication (it breaks Windows auth and MFA-only setups).
      identifierFormat: null,
      disableRequestedAuthnContext: true,
    });
  }

  async start(ctx: SsoStartContext): Promise<SsoStart> {
    if (!ctx.domain) {
      throw new BadRequestException('Enter your school email to sign in with SSO');
    }
    if (!this.readyFor(ctx.domain)) {
      throw new BadRequestException('Your school has not set up single sign-on yet');
    }

    let requestId = '';
    let requestedAt = '';
    const capture: CacheProvider = {
      saveAsync: (key, value) => {
        requestId = key;
        requestedAt = value;
        return Promise.resolve({ value, createdAt: Date.now() });
      },
      getAsync: () => Promise.resolve(null),
      removeAsync: () => Promise.resolve(null),
    };
    const url = await this.client(ctx.domain, capture).getAuthorizeUrlAsync(
      ctx.state,
      undefined,
      {},
    );
    if (!requestId) throw new Error('No SAML request id');
    return {
      url,
      secrets: { domainId: ctx.domain.id, requestId, requestedAt },
    };
  }

  async complete(ctx: SsoCompleteContext): Promise<SsoIdentity> {
    const domain = ctx.domain;
    if (!ctx.samlResponse) throw new Error('No SAMLResponse');
    if (!domain || domain.id !== ctx.secrets.domainId || !this.readyFor(domain)) {
      throw new Error('The SAML connection changed during sign-in');
    }

    // Only the request this sign-in sent is a valid InResponseTo.
    const { requestId, requestedAt } = ctx.secrets;
    const expected: CacheProvider = {
      saveAsync: () => Promise.resolve(null),
      getAsync: (key) => Promise.resolve(key === requestId ? requestedAt : null),
      removeAsync: () => Promise.resolve(null),
    };
    const { profile } = await this.client(domain, expected).validatePostResponseAsync({
      SAMLResponse: ctx.samlResponse,
    });
    if (!profile) throw new Error('Not a sign-in response');
    if (profile.issuer?.trim() !== domain.samlIssuer!.trim()) {
      throw new Error('Unexpected SAML issuer');
    }
    return this.identityFrom(profile, domain);
  }

  identityFrom(profile: Profile, domain: SsoDomainConfig): SsoIdentity {
    const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
    const claims: Record<string, unknown> = {
      ...attributes,
      issuer: profile.issuer,
      nameID: profile.nameID,
      nameIDFormat: profile.nameIDFormat,
    };

    const fromAttrs = claimString(attributes, ...EMAIL_ATTRS);
    const fromProfile = claimString(profile, 'email', 'mail');
    const candidates = [fromProfile, fromAttrs, profile.nameID];
    const email =
      candidates.find((c): c is string => !!c && !!emailDomainOf(c))?.toLowerCase() ??
      null;

    // A transient NameID changes every sign-in; the address is steadier.
    const transient = profile.nameIDFormat?.endsWith(':transient');
    const name = transient ? email : profile.nameID;
    if (!name) throw new Error('SAML assertion without a subject');

    return {
      provider: this.id,
      // Namespaced by domain: one school's IdP can never assert a subject
      // that belongs to another school's.
      subject: `${domain.id}:${name}`,
      email,
      emailVerified: emailDomainOf(email) === domain.domain,
      claims,
      profile: this.profileFrom(claims),
      verifiedFor: domain.domain,
    };
  }

  profileFrom(claims: Record<string, unknown>): SsoProfile {
    return standardProfile(claims, {
      first: FIRST_ATTRS,
      last: LAST_ATTRS,
      full: FULL_ATTRS,
      picture: [],
    });
  }

  vouchesForDomain(identity: SsoIdentity, ctx: SsoDomainContext): boolean {
    return (
      identity.provider === this.id &&
      identity.verifiedFor === ctx.domain &&
      emailDomainOf(identity.email) === ctx.domain
    );
  }

  /** Our SP metadata, for the school to load into its IdP. */
  metadata(): string {
    return generateServiceProviderMetadata({
      issuer: samlEntityId(),
      callbackUrl: samlAcsUrl(),
      wantAssertionsSigned: true,
      identifierFormat: null,
    });
  }
}
