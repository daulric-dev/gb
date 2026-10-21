import type { User } from '@supabase/supabase-js';
import type { SsoDomainContext } from '../sso.types';
import { claim, claimString, emailDomainOf, identityFor } from './claims';
import { OAuthAdapter } from './oauth.adapter';

/**
 * Google Workspace / Google for Education.
 *
 * Google vouches for a school address when the account belongs to the
 * school's Workspace: the token's `hd` (hosted domain) claim names it. The
 * check accepts the domain itself or a parent of it, since a Workspace for
 * srmss.edu.gd also hosts students.srmss.edu.gd.
 */
export class GoogleAdapter extends OAuthAdapter {
  constructor() {
    super({
      id: 'google',
      label: 'Google',
      scopes: 'openid email profile',
      queryParams: (input) => ({
        // Ask for the school account directly instead of whichever Google
        // account the browser last used.
        prompt: 'select_account',
        ...(input.email ? { login_hint: input.email } : {}),
        ...(input.domain ? { hd: input.domain } : {}),
      }),
    });
  }

  vouchesForDomain(user: User, ctx: SsoDomainContext): boolean {
    const identity = identityFor(user, 'google');
    if (!identity || claim(identity, 'email_verified') === false) return false;
    if (emailDomainOf(user) !== ctx.domain) return false;

    const hd = claimString(identity, 'hd')?.toLowerCase();
    return !!hd && (ctx.domain === hd || ctx.domain.endsWith(`.${hd}`));
  }
}
