import { BadRequestException } from '@nestjs/common';
import { emailDomainOf } from '../sso.config';
import type {
  SsoDomainConfig,
  SsoDomainContext,
  SsoIdentity,
  SsoStartContext,
} from '../sso.types';
import { claimString } from './profile';
import { OidcAdapter } from './oidc.adapter';

const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The issuer (and authority) of one Entra tenant. */
export function tenantIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId.toLowerCase()}/v2.0`;
}

/**
 * Microsoft 365 / Entra ID.
 *
 * Every sign-in goes to the school's own tenant authority, never `common`,
 * so the ID token's issuer is checked strictly and accounts from any other
 * tenant cannot sign in through it at all. That is why the user has to type
 * their school email first: it picks the tenant.
 *
 * Microsoft does not promise that the email claim of an arbitrary account is
 * verified - an admin of any tenant can put any address on a user (the
 * "nOAuth" problem). So a Microsoft sign-in only vouches for a school address
 * when it comes from the school's own tenant, which the school admin records
 * on the domain.
 *
 * Credentials: the school's own app registration (single tenant is fine,
 * since sign-in always uses the school's tenant authority), else the
 * install-wide env MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET (a
 * multitenant app) for schools that have not saved one.
 */
export class AzureAdapter extends OidcAdapter {
  constructor() {
    super({
      id: 'azure',
      label: 'Microsoft',
      clientIdEnv: 'MICROSOFT_CLIENT_ID',
      clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
      adminNotes:
        'In the Microsoft Entra admin center, register an application with a Web redirect URI set to the one below ("Accounts in this organizational directory only" is enough for your own school). Create a client secret under Certificates & secrets and paste the Application (client) ID and the secret value here. Then add your tenant ID on each email domain that uses Microsoft.',
    });
  }

  readyFor(domain: SsoDomainConfig): boolean {
    return !!domain.azureTenantId && TENANT_ID.test(domain.azureTenantId);
  }

  protected issuerFor(ctx: SsoStartContext): string {
    if (!ctx.domain) {
      throw new BadRequestException(
        'Enter your school email to sign in with Microsoft',
      );
    }
    if (!this.readyFor(ctx.domain)) {
      throw new BadRequestException(
        'Your school has not set up Microsoft sign-in yet',
      );
    }
    return tenantIssuer(ctx.domain.azureTenantId!);
  }

  protected authorizationParams(ctx: SsoStartContext): Record<string, string> {
    return ctx.email ? { login_hint: ctx.email } : {};
  }

  /** `email` when present, else the sign-in name when it is an address. */
  protected emailFrom(claims: Record<string, unknown>): string | null {
    return (
      super.emailFrom(claims) ??
      (() => {
        const upn = claimString(claims, 'preferred_username');
        return upn && emailDomainOf(upn) ? upn : null;
      })()
    );
  }

  /** The tenant the token was issued by. */
  tenantOf(identity: SsoIdentity): string | null {
    return claimString(identity.claims, 'tid')?.toLowerCase() ?? null;
  }

  vouchesForDomain(identity: SsoIdentity, ctx: SsoDomainContext): boolean {
    if (identity.provider !== this.id || !ctx.azureTenantId) return false;
    if (emailDomainOf(identity.email) !== ctx.domain) return false;
    const tenant = ctx.azureTenantId.toLowerCase();
    const issuer = claimString(identity.claims, 'iss');
    return (
      this.tenantOf(identity) === tenant &&
      (issuer === null || issuer.toLowerCase() === tenantIssuer(tenant))
    );
  }
}
