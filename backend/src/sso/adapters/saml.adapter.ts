import type { User } from '@supabase/supabase-js';
import type {
  SsoAdapter,
  SsoDomainContext,
  SsoProfile,
  SsoStartInput,
} from '../sso.types';
import { emailDomainOf, standardProfile } from './claims';
import { enabledProviders } from './supabase-oauth.adapter';

/**
 * SAML 2.0 through Supabase SSO (ADFS, Okta, ClassLink, Shibboleth, ...).
 *
 * Each school's identity provider is registered with Supabase against its
 * domains by the platform operator (`supabase sso add --type saml
 * --metadata-url ... --domains srmss.edu.gd`). Supabase then routes a sign-in
 * for that domain to that provider and only accepts addresses on the domains
 * it was registered for, so a SAML sign-in vouches for its domain.
 */
export class SamlAdapter implements SsoAdapter {
  readonly id = 'saml';
  readonly label = 'your school (SSO)';
  readonly kind = 'saml' as const;

  isEnabled(): boolean {
    return enabledProviders().has(this.id);
  }

  async start(input: SsoStartInput): Promise<string> {
    const domain = input.domain ?? input.email?.split('@')[1];
    if (!domain) throw new Error('SAML sign-in needs the school email address');

    const { data, error } = await input.client.auth.signInWithSSO({
      domain,
      options: { redirectTo: input.redirectTo },
    });
    if (error || !data?.url) {
      throw new Error(error?.message ?? 'No SAML provider for that domain');
    }
    return data.url;
  }

  profileFrom(user: User): SsoProfile {
    // Supabase files SAML attributes under the identity like OpenID claims;
    // map them with `supabase sso update --attribute-mapping-file` so
    // given_name / family_name / email arrive under those names.
    const identity = user.identities?.find((i) => i.provider.startsWith('sso:'));
    return standardProfile(user, identity?.provider ?? 'sso');
  }

  vouchesForDomain(user: User, ctx: SsoDomainContext): boolean {
    const viaSaml = user.identities?.some((i) => i.provider.startsWith('sso:'));
    return !!viaSaml && emailDomainOf(user) === ctx.domain;
  }
}
