import type { Provider, User } from '@supabase/supabase-js';
import type {
  SsoAdapter,
  SsoDomainContext,
  SsoProfile,
  SsoStartInput,
} from '../sso.types';
import { standardProfile } from './claims';

export interface OAuthAdapterOptions {
  id: string;
  label: string;
  /** The Supabase Auth provider name; defaults to `id`. */
  provider?: Provider;
  scopes?: string;
  /** Extra query parameters for the provider's authorize URL. */
  queryParams?: (input: SsoStartInput) => Record<string, string>;
}

/**
 * Any OAuth/OpenID provider Supabase Auth supports, by configuration.
 *
 * It never vouches for a domain on its own: providers differ in whether the
 * email they send is verified, so each one that should let people join a
 * school by domain gets a subclass that checks its own claims (see Google
 * and Microsoft).
 */
export class OAuthAdapter implements SsoAdapter {
  readonly kind = 'oauth' as const;
  readonly id: string;
  readonly label: string;
  protected readonly provider: Provider;

  constructor(protected readonly options: OAuthAdapterOptions) {
    this.id = options.id;
    this.label = options.label;
    this.provider = options.provider ?? (options.id as Provider);
  }

  isEnabled(): boolean {
    return enabledProviders().has(this.id);
  }

  async start(input: SsoStartInput): Promise<string> {
    const { data, error } = await input.client.auth.signInWithOAuth({
      provider: this.provider,
      options: {
        redirectTo: input.redirectTo,
        skipBrowserRedirect: true,
        scopes: this.options.scopes,
        queryParams: this.options.queryParams?.(input),
      },
    });
    if (error || !data?.url) {
      throw new Error(error?.message ?? `No sign-in URL from ${this.id}`);
    }
    return data.url;
  }

  profileFrom(user: User): SsoProfile {
    return standardProfile(user, this.provider);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vouchesForDomain(user: User, domain: SsoDomainContext): boolean {
    return false;
  }
}

/** SSO_PROVIDERS=google,azure,saml - the adapters this deployment turns on. */
export function enabledProviders(): Set<string> {
  return new Set(
    (process.env.SSO_PROVIDERS ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
}
