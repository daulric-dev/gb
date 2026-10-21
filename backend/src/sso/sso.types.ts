/**
 * One way of signing in through a school's identity provider.
 *
 * Adding a provider means writing one of these and registering it in
 * sso.registry.ts - nothing else in the app knows which providers exist. See
 * docs/content/sso.md for the walkthrough.
 *
 * Our server speaks the protocol itself (OpenID Connect or SAML 2.0); an
 * adapter builds the provider's sign-in URL, checks what comes back, and
 * turns it into an SsoIdentity.
 */
export interface SsoAdapter {
  /** Stable id, stored on school_email_domain.sso_provider and account.identity.provider. */
  readonly id: string;
  /** Shown on the button: "Continue with <label>". */
  readonly label: string;
  readonly kind: 'oauth' | 'saml';

  /** Whether this deployment has the provider configured. */
  isEnabled(): boolean;

  /**
   * Whether a school domain has what this adapter needs (a Microsoft tenant,
   * a SAML connection). Adapters that need nothing per school return true.
   */
  readyFor(domain: SsoDomainConfig): boolean;

  /**
   * The URL to send the browser to. `secrets` come back in `complete`
   * unchanged and are never shown to the browser (PKCE verifier, nonce,
   * SAML request id, the tenant the sign-in was started for).
   */
  start(ctx: SsoStartContext): Promise<SsoStart>;

  /**
   * Check the provider's response and say who signed in. Throws when the
   * response is not acceptable (bad signature, wrong issuer or audience,
   * expired, replayed).
   */
  complete(ctx: SsoCompleteContext): Promise<SsoIdentity>;

  /** Name and picture from the claims or attributes the provider sent. */
  profileFrom(claims: Record<string, unknown>): SsoProfile;

  /**
   * Whether the provider vouches that this user really owns their address
   * at `domain`. Joining a school by domain depends on it, so an adapter
   * that cannot tell must return false, never guess.
   */
  vouchesForDomain(identity: SsoIdentity, domain: SsoDomainContext): boolean;

  /**
   * Whether the address is the provider's verified one even when it does not
   * vouch for a school (a personal Gmail address). Lets the sign-in link to
   * an existing account with that address. Defaults to false.
   */
  verifiesEmail?(identity: SsoIdentity): boolean;
}

/** A school email domain, as an adapter sees it. */
export interface SsoDomainConfig {
  id: string;
  domain: string;
  azureTenantId: string | null;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlCertificate: string | null;
}

export interface SsoStartContext {
  /** Random, single-use; sent to the provider and checked on the way back. */
  state: string;
  /** Our OpenID Connect redirect URI. */
  redirectUri: string;
  /** The address the user typed, when they typed one. */
  email?: string;
  /** The verified school domain of that address, when there is one. */
  domain: SsoDomainConfig | null;
}

export interface SsoStart {
  url: string;
  secrets: Record<string, string>;
}

export interface SsoCompleteContext {
  state: string;
  secrets: Record<string, string>;
  /** The domain the sign-in was started for, reloaded. */
  domain: SsoDomainConfig | null;
  /** OpenID Connect: the callback URL with the provider's query parameters. */
  callbackUrl?: URL;
  /** SAML: the base64 SAMLResponse form field. */
  samlResponse?: string;
}

/** Who signed in, as the provider told us. */
export interface SsoIdentity {
  /** Adapter id. */
  provider: string;
  /** Stable id at the provider; unique together with `provider`. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** Raw claims (OIDC) or attributes (SAML), stored on account.identity. */
  claims: Record<string, unknown>;
  profile: SsoProfile;
  /**
   * The school domain whose own configuration verified this sign-in (SAML:
   * the domain whose certificate signed the assertion). Set by the adapter,
   * never from anything the provider sent.
   */
  verifiedFor?: string;
}

export interface SsoProfile {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/** What an adapter may check a sign-in against. */
export interface SsoDomainContext {
  domain: string;
  azureTenantId: string | null;
}

/** The public view of an adapter, for login buttons and the admin picker. */
export interface SsoProviderInfo {
  id: string;
  label: string;
  kind: 'oauth' | 'saml';
}
