import type { User } from '@supabase/supabase-js';
import type { SsoDomainContext } from '../sso.types';
import { claimString, emailDomainOf, identityFor } from './claims';
import { OAuthAdapter } from './oauth.adapter';

const TENANT_IN_ISSUER = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\//i;

/**
 * Microsoft 365 / Entra ID.
 *
 * Microsoft does not promise that the email claim of an arbitrary account is
 * verified - an admin of any tenant can put any address on a user (the
 * "nOAuth" problem). So a Microsoft sign-in only vouches for a school address
 * when it comes from the school's own tenant, which the school admin records
 * on the domain.
 */
export class AzureAdapter extends OAuthAdapter {
  constructor() {
    super({
      id: 'azure',
      label: 'Microsoft',
      scopes: 'openid email profile',
      queryParams: (input): Record<string, string> =>
        input.email ? { login_hint: input.email } : {},
    });
  }

  /** The tenant the token was issued by, from `tid` or the issuer URL. */
  tenantOf(user: User): string | null {
    const identity = identityFor(user, 'azure');
    const tid = claimString(identity, 'tid');
    if (tid) return tid.toLowerCase();
    const iss = claimString(identity, 'iss');
    const match = iss ? TENANT_IN_ISSUER.exec(iss) : null;
    return match ? match[1].toLowerCase() : null;
  }

  vouchesForDomain(user: User, ctx: SsoDomainContext): boolean {
    if (!ctx.azureTenantId) return false;
    if (emailDomainOf(user) !== ctx.domain) return false;
    return this.tenantOf(user) === ctx.azureTenantId.toLowerCase();
  }
}
