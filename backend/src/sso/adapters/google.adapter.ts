import { emailDomainOf } from '../sso.config';
import type {
  SsoDomainContext,
  SsoIdentity,
  SsoStartContext,
} from '../sso.types';
import { claimString } from './profile';
import { OidcAdapter } from './oidc.adapter';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_MAIL = new Set(['gmail.com', 'googlemail.com']);

/**
 * Google Workspace / Google for Education (and personal Google accounts).
 *
 * Google vouches for a school address when the account belongs to the
 * school's Workspace: the token's `hd` (hosted domain) claim names it. The
 * check accepts the domain itself or a parent of it, since a Workspace for
 * srmss.edu.gd also hosts students.srmss.edu.gd.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
export class GoogleAdapter extends OidcAdapter {
  constructor() {
    super({
      id: 'google',
      label: 'Google',
      clientIdEnv: 'GOOGLE_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    });
  }

  protected issuerFor(): string {
    return GOOGLE_ISSUER;
  }

  protected authorizationParams(ctx: SsoStartContext): Record<string, string> {
    const hd = ctx.domain?.domain ?? emailDomainOf(ctx.email);
    return {
      // Ask for the school account directly instead of whichever Google
      // account the browser last used.
      prompt: 'select_account',
      ...(ctx.email ? { login_hint: ctx.email } : {}),
      ...(hd ? { hd } : {}),
    };
  }

  vouchesForDomain(identity: SsoIdentity, ctx: SsoDomainContext): boolean {
    if (identity.provider !== this.id || !identity.emailVerified) return false;
    if (emailDomainOf(identity.email) !== ctx.domain) return false;

    const hd = claimString(identity.claims, 'hd')?.toLowerCase();
    return !!hd && (ctx.domain === hd || ctx.domain.endsWith(`.${hd}`));
  }

  /**
   * Google only asserts email_verified for addresses it controls: Gmail, or
   * a Workspace's own domain (hd).
   */
  verifiesEmail(identity: SsoIdentity): boolean {
    if (identity.provider !== this.id || !identity.emailVerified) return false;
    const domain = emailDomainOf(identity.email);
    const hd = claimString(identity.claims, 'hd')?.toLowerCase();
    return (
      !!domain &&
      (GOOGLE_MAIL.has(domain) ||
        (!!hd && (domain === hd || domain.endsWith(`.${hd}`))))
    );
  }
}
