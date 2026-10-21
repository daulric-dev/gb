import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * One way of signing in through a school's identity provider.
 *
 * Adding a provider means writing one of these and registering it in
 * sso.registry.ts - nothing else in the app knows which providers exist. See
 * docs/content/sso.md for the walkthrough.
 */
export interface SsoAdapter {
  /** Stable id, stored on school_email_domain.sso_provider. */
  readonly id: string;
  /** Shown on the button: "Continue with <label>". */
  readonly label: string;
  readonly kind: 'oauth' | 'saml';

  /** Whether this deployment has the provider configured. */
  isEnabled(): boolean;

  /**
   * The URL to send the browser to. `client` is a cookie-bound Supabase
   * client, so the PKCE verifier lands in a cookie the callback can read.
   */
  start(input: SsoStartInput): Promise<string>;

  /** Name and picture from whatever the provider sent. */
  profileFrom(user: User): SsoProfile;

  /**
   * Whether the provider vouches that this user really owns their address
   * at `domain`. Joining a school by domain depends on it, so an adapter
   * that cannot tell must return false, never guess.
   */
  vouchesForDomain(user: User, domain: SsoDomainContext): boolean;
}

export interface SsoStartInput {
  /** Only `.auth` is used; any schema the cookie client was built for will do. */
  client: SupabaseClient<any, any, any>;
  /** Absolute URL of our callback, already carrying our own state params. */
  redirectTo: string;
  /** The address the user typed, when they typed one. */
  email?: string;
  /** The school domain we expect them to sign in under, when known. */
  domain?: string;
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
