import * as oidc from 'openid-client';
import { enabledProviders, emailDomainOf } from '../sso.config';
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

export interface OidcAdapterOptions {
  id: string;
  label: string;
  /** Env vars holding the OAuth client credentials. */
  clientIdEnv: string;
  clientSecretEnv: string;
  scope?: string;
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
  /** Discovery results per issuer, fetched once. */
  private readonly configs = new Map<string, Promise<oidc.Configuration>>();

  constructor(protected readonly options: OidcAdapterOptions) {
    this.id = options.id;
    this.label = options.label;
  }

  protected clientId(): string | undefined {
    return process.env[this.options.clientIdEnv]?.trim() || undefined;
  }

  protected clientSecret(): string | undefined {
    return process.env[this.options.clientSecretEnv]?.trim() || undefined;
  }

  isEnabled(): boolean {
    return (
      enabledProviders().has(this.id) && !!this.clientId() && !!this.clientSecret()
    );
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

  protected configuration(issuer: string): Promise<oidc.Configuration> {
    let config = this.configs.get(issuer);
    if (!config) {
      config = oidc.discovery(
        new URL(issuer),
        this.clientId()!,
        this.clientSecret(),
      );
      // A failed lookup is retried next time rather than cached.
      config.catch(() => this.configs.delete(issuer));
      this.configs.set(issuer, config);
    }
    return config;
  }

  async start(ctx: SsoStartContext): Promise<SsoStart> {
    const issuer = this.issuerFor(ctx);
    const config = await this.configuration(issuer);
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
    const config = await this.configuration(issuer);
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
