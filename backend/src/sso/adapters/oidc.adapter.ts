import { createHash } from 'node:crypto';
import * as oidc from 'openid-client';
import { enabledProviders, emailDomainOf } from '../sso.config';
import type {
  SsoAdapter,
  SsoClientContext,
  SsoCompleteContext,
  SsoDomainConfig,
  SsoDomainContext,
  SsoIdentity,
  SsoProfile,
  SsoProviderConfig,
  SsoSettingField,
  SsoStart,
  SsoStartContext,
} from '../sso.types';
import { claimString, standardProfile } from './profile';

/** Most discovery documents kept at once (schools x issuers). */
const MAX_CLIENTS = 500;

export interface OidcAdapterOptions {
  id: string;
  label: string;
  /** Env vars holding the install-wide OAuth client (the fallback for schools without their own). */
  clientIdEnv: string;
  clientSecretEnv: string;
  scope?: string;
  /** Setup hints for school admins. */
  adminNotes?: string;
}

/**
 * Any OpenID Connect provider, spoken directly with openid-client:
 * authorization code flow with PKCE (S256), state and nonce, and the ID
 * token's issuer, audience, signature and expiry checked against the
 * provider's discovery document.
 *
 * It never vouches for a domain on its own: providers differ in whether the
 * email they send is verified, so each one that should let people join a
 * school by domain checks its own claims (see Google and Microsoft).
 */
export abstract class OidcAdapter implements SsoAdapter {
  readonly kind = 'oauth' as const;
  readonly id: string;
  readonly label: string;
  readonly adminNotes?: string;
  readonly needsClient = true;
  readonly settingFields: readonly SsoSettingField[] = [];
  /**
   * Discovery results per (client, issuer): `clientKey` (a school, or the
   * env) plus the issuer. Each entry remembers a hash of the credentials it
   * was made with and is replaced when they change, so credentials a school
   * saves take effect at once and one school's client is never used for
   * another's sign-in.
   */
  private readonly configs = new Map<
    string,
    { client: string; config: Promise<oidc.Configuration> }
  >();

  constructor(protected readonly options: OidcAdapterOptions) {
    this.id = options.id;
    this.label = options.label;
    this.adminNotes = options.adminNotes;
  }

  envConfig(): SsoProviderConfig {
    return {
      enabled: enabledProviders().has(this.id),
      clientId: process.env[this.options.clientIdEnv]?.trim() || null,
      clientSecret: process.env[this.options.clientSecretEnv]?.trim() || null,
      settings: {},
    };
  }

  available(config: SsoProviderConfig): boolean {
    return config.enabled && !!config.clientId && !!config.clientSecret;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readyFor(domain: SsoDomainConfig): boolean {
    return true;
  }

  /**
   * The issuer this sign-in goes to. Throw an HttpException with a message
   * for the user when the sign-in cannot start.
   */
  protected abstract issuerFor(ctx: SsoStartContext): string;

  /** Extra authorize parameters (login_hint, prompt, ...). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected authorizationParams(ctx: SsoStartContext): Record<string, string> {
    return {};
  }

  /** Discovery for `issuer` under the sign-in's own client. */
  protected configuration(
    issuer: string,
    ctx: SsoClientContext,
  ): Promise<oidc.Configuration> {
    const { clientId, clientSecret } = ctx.config;
    if (!clientId || !clientSecret) {
      return Promise.reject(new Error(`${this.label} has no client credentials`));
    }
    const client = createHash('sha256')
      .update(`${clientId}\n${clientSecret}`)
      .digest('hex');
    const key = `${ctx.clientKey}\n${issuer}`;
    const cached = this.configs.get(key);
    if (cached && cached.client === client) return cached.config;

    const config = oidc.discovery(new URL(issuer), clientId, clientSecret);
    // A failed lookup is retried next time rather than cached.
    config.catch(() => {
      if (this.configs.get(key)?.config === config) this.configs.delete(key);
    });
    // Bounded: one entry per school and issuer in use; drop the oldest.
    if (this.configs.size >= MAX_CLIENTS) {
      const oldest = this.configs.keys().next().value;
      if (oldest !== undefined) this.configs.delete(oldest);
    }
    this.configs.set(key, { client, config });
    return config;
  }

  async start(ctx: SsoStartContext): Promise<SsoStart> {
    const issuer = this.issuerFor(ctx);
    const config = await this.configuration(issuer, ctx);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      ...this.authorizationParams(ctx),
      redirect_uri: ctx.redirectUri,
      response_type: 'code',
      scope: this.options.scope ?? 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state: ctx.state,
      nonce,
    });
    return { url: url.href, secrets: { issuer, codeVerifier, nonce } };
  }

  async complete(ctx: SsoCompleteContext): Promise<SsoIdentity> {
    if (!ctx.callbackUrl) throw new Error('No authorization response');
    const { issuer, codeVerifier, nonce } = ctx.secrets;
    const config = await this.configuration(issuer, ctx);
    const tokens = await oidc.authorizationCodeGrant(config, ctx.callbackUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: ctx.state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('No ID token');
    return this.identityFrom({ ...claims });
  }

  /** Our identity from verified ID token claims. */
  identityFrom(claims: Record<string, unknown>): SsoIdentity {
    const subject = claimString(claims, 'sub');
    if (!subject) throw new Error('ID token without a subject');
    const email = this.emailFrom(claims)?.toLowerCase() ?? null;
    return {
      provider: this.id,
      subject,
      email,
      emailVerified: claims.email_verified === true,
      claims,
      profile: this.profileFrom(claims),
    };
  }

  protected emailFrom(claims: Record<string, unknown>): string | null {
    const email = claimString(claims, 'email');
    return email && emailDomainOf(email) ? email : null;
  }

  profileFrom(claims: Record<string, unknown>): SsoProfile {
    return standardProfile(claims);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vouchesForDomain(identity: SsoIdentity, domain: SsoDomainContext): boolean {
    return false;
  }
}
