import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { primaryOrigin } from '@/config/origins';
import { AccountService } from '@/account/account.service';
import { SessionService } from '@/account/session.service';
import {
  EmailDomainService,
  type VerifiedDomain,
} from '@/email-domain/email-domain.service';
import { SsoRegistry, info } from './sso.registry';
import { apiBase, oidcRedirectUri } from './sso.config';
import { SamlAdapter } from './adapters/saml.adapter';
import type {
  SsoAdapter,
  SsoDomainConfig,
  SsoIdentity,
  SsoProfile,
  SsoProviderInfo,
} from './sso.types';

export type SsoPlatform = 'web' | 'mobile';

/** Where the mobile app picks up a finished sign-in. */
const MOBILE_RETURN = process.env.MOBILE_SSO_RETURN_URL || 'gradebook://sso';
const STATE_TTL_S = 10 * 60;
const HANDOFF_TTL_S = 120;
/**
 * Ties a sign-in to the browser that started it, so nobody can finish their
 * own sign-in in someone else's browser (login CSRF).
 */
export const FLOW_COOKIE = 'gb_sso_flow';
const FLOW_COOKIE_PATH = '/api/auth/sso';

const stateKey = (state: string) => `sso-state:${state}`;
const handoffKey = (code: string) => `sso-handoff:${code}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** A sign-in between /start and the callback, kept server side. */
export interface PendingSignIn {
  provider: string;
  platform: SsoPlatform;
  next: string | null;
  /** The verified domain the sign-in started for, reloaded at the end. */
  domainId: string | null;
  /** Adapter secrets: PKCE verifier, nonce, SAML request id, issuer. */
  secrets: Record<string, string>;
  /** SHA-256 (hex) of the flow cookie set on the starting browser. */
  binding: string;
  /** SAML: the checked identity, between the ACS and the callback. */
  identity?: SsoIdentity;
}

/**
 * A relative path on our own site, or null. Sign-in redirects after the
 * provider round trip, so anything else would be an open redirect.
 */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string' || next.length > 2048) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\'))
    return null;
  // Whitespace and control characters (code points below 0x20).
  if (/\s/.test(next) || [...next].some((c) => c.charCodeAt(0) < 0x20))
    return null;
  try {
    const resolved = new URL(next, 'http://x.invalid');
    if (resolved.origin !== 'http://x.invalid') return null;
    if (resolved.pathname.startsWith('/login')) return null;
    return resolved.pathname + resolved.search;
  } catch {
    return null;
  }
}

function domainConfig(d: VerifiedDomain | null): SsoDomainConfig | null {
  return d
    ? {
        id: d.id,
        domain: d.domain,
        azureTenantId: d.azureTenantId,
        samlEntryPoint: d.samlEntryPoint,
        samlIssuer: d.samlIssuer,
        samlCertificate: d.samlCertificate,
      }
    : null;
}

/**
 * Sign-in through a school's identity provider, end to end, with our own
 * OpenID Connect and SAML.
 *
 * The browser goes /start -> provider -> our callback (or SAML ACS) -> the
 * app. The adapter builds the provider URL, checks the response, and says
 * whether it vouches for the school domain; this service keeps the pending
 * state, finds or creates the user, starts a session, and - when the domain
 * is the school's - gives them a profile and a seat in the school, so a
 * student with a school account never fills in a form.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly registry: SsoRegistry,
    private readonly domains: EmailDomainService,
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
  ) {}

  providers(): SsoProviderInfo[] {
    return this.registry.enabled();
  }

  /**
   * What the login page should offer for an address: its school's provider,
   * and whether email codes are off for it.
   */
  async discover(email: string) {
    const domain = await this.domains.verifiedDomainFor(email);
    const adapter = this.registry.get(domain?.ssoProvider);
    const ready = !!adapter && !!domain && adapter.readyFor(domain);
    return {
      provider: ready && adapter ? info(adapter) : null,
      required: !!(ready && domain?.ssoRequired),
    };
  }

  /** Our SP metadata XML, or null when SAML is off. */
  samlMetadata(): string | null {
    const adapter = this.registry.get('saml');
    return adapter instanceof SamlAdapter ? adapter.metadata() : null;
  }

  // ── start ─────────────────────────────────────────────────────────────────

  /** The provider's sign-in URL; the controller redirects there. */
  async start(
    req: FastifyRequest,
    reply: FastifyReply,
    providerId: string,
    input: { next?: string; platform?: SsoPlatform; email?: string },
  ): Promise<string> {
    const adapter = this.registry.get(providerId);
    if (!adapter)
      throw new NotFoundException('That sign-in option is not available');

    const email = input.email?.trim().toLowerCase() || undefined;
    const domain = email ? await this.domains.verifiedDomainFor(email) : null;
    const state = randomBytes(24).toString('base64url');
    const flow = randomBytes(24).toString('base64url');

    let started: Awaited<ReturnType<SsoAdapter['start']>>;
    try {
      started = await adapter.start({
        state,
        redirectUri: oidcRedirectUri(req),
        email,
        domain: domainConfig(domain),
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `SSO start via ${adapter.id} failed: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `Could not start sign-in with ${adapter.label}`,
      );
    }

    const pending: PendingSignIn = {
      provider: adapter.id,
      platform: input.platform === 'mobile' ? 'mobile' : 'web',
      next: safeNext(input.next),
      domainId: domain?.id ?? null,
      secrets: started.secrets,
      binding: sha256(flow).toString('hex'),
    };
    await this.cache.set(stateKey(state), pending, STATE_TTL_S);

    reply.setCookie(FLOW_COOKIE, flow, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: FLOW_COOKIE_PATH,
      maxAge: STATE_TTL_S,
    });
    return started.url;
  }

  // ── finish ────────────────────────────────────────────────────────────────

  private failUrl(platform: SsoPlatform, reason: string): string {
    return platform === 'mobile'
      ? `${MOBILE_RETURN}?error=${encodeURIComponent(reason)}`
      : `${primaryOrigin()}/login?error=${encodeURIComponent(reason)}`;
  }

  /** The pending sign-in for a state, removed: each state works once. */
  async takeState(state: unknown): Promise<PendingSignIn | null> {
    if (typeof state !== 'string' || !state || state.length > 128) return null;
    const pending = (await this.cache.get(stateKey(state))) as PendingSignIn | null;
    await this.cache.delete(stateKey(state));
    return pending;
  }

  private async reloadDomain(pending: PendingSignIn): Promise<SsoDomainConfig | null> {
    if (!pending.domainId) return null;
    return domainConfig(await this.domains.verifiedDomainById(pending.domainId));
  }

  /**
   * SAML: the IdP posts the assertion here (cross-site, so the browser sends
   * no Lax cookies). Check it, park the identity under the state, and send
   * the browser on to the callback, which runs as a top-level GET with the
   * flow cookie. Never throws.
   */
  async samlAcs(body: Record<string, unknown>): Promise<string> {
    const state = typeof body.RelayState === 'string' ? body.RelayState : '';
    const samlResponse =
      typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
    // An assertion already accepted for this state waits for the callback;
    // a second post (a replay) neither replaces nor consumes it.
    const parked = (await this.cache.get(stateKey(state))) as PendingSignIn | null;
    if (parked?.identity) return this.failUrl(parked.platform, 'expired');
    const pending = await this.takeState(state);
    if (!pending || pending.provider !== 'saml') {
      return this.failUrl(pending?.platform ?? 'web', 'expired');
    }
    const adapter = this.registry.get('saml');
    if (!adapter) return this.failUrl(pending.platform, 'provider');

    try {
      const identity = await adapter.complete({
        state,
        secrets: pending.secrets,
        domain: await this.reloadDomain(pending),
        samlResponse,
      });
      await this.cache.set(stateKey(state), { ...pending, identity }, HANDOFF_TTL_S);
    } catch (err) {
      this.logger.warn(`SAML response rejected: ${(err as Error).message}`);
      return this.failUrl(pending.platform, 'failed');
    }
    return `${apiBase()}/api/auth/sso/callback?state=${encodeURIComponent(state)}`;
  }

  /**
   * Finish the sign-in and decide where to send the user. Never throws: any
   * failure becomes a redirect to the login page with a reason, since there
   * is no page of ours on screen to show an error on.
   */
  async callback(
    req: FastifyRequest,
    reply: FastifyReply,
    query: Record<string, string | undefined>,
  ): Promise<string> {
    const pending = await this.takeState(query.state);
    const flow = req.cookies?.[FLOW_COOKIE];
    reply.clearCookie(FLOW_COOKIE, { path: FLOW_COOKIE_PATH });
    if (!pending) return this.failUrl('web', query.error ? 'cancelled' : 'expired');

    const fail = (reason: string) => this.failUrl(pending.platform, reason);
    if (!flow || !timingSafeEqual(sha256(flow), Buffer.from(pending.binding, 'hex'))) {
      return fail('expired');
    }
    if (query.error) {
      return fail(query.error_description || query.error || 'cancelled');
    }

    const adapter = this.registry.get(pending.provider);
    if (!adapter) return fail('provider');

    let identity: SsoIdentity;
    try {
      identity =
        pending.identity ??
        (await adapter.complete({
          state: query.state!,
          secrets: pending.secrets,
          domain: await this.reloadDomain(pending),
          callbackUrl: this.currentUrl(req),
        }));
    } catch (err) {
      this.logger.warn(
        `SSO response from ${adapter.id} rejected: ${(err as Error).message}`,
      );
      return fail('expired');
    }

    let user: { id: string; email: string };
    let destination: string;
    try {
      ({ user, destination } = await this.signIn(identity, adapter, pending.next));
    } catch (err) {
      const message =
        err instanceof ForbiddenException ? err.message : 'failed';
      if (!(err instanceof ForbiddenException)) {
        this.logger.error(`SSO sign-in failed: ${(err as Error).message}`);
      }
      return fail(message);
    }

    if (pending.platform === 'mobile') {
      // The app has its own cookie jar; the browser's cookies cannot reach
      // it. Hand the sign-in over once, briefly, by an unguessable code.
      const code = randomBytes(24).toString('base64url');
      await this.cache.set(
        handoffKey(code),
        { userId: user.id, provider: adapter.id },
        HANDOFF_TTL_S,
      );
      return `${MOBILE_RETURN}?code=${code}`;
    }

    await this.sessions.create(reply, req, user.id, adapter.id);
    return `${primaryOrigin()}${destination}`;
  }

  /** The callback URL as the provider called it, for openid-client. */
  private currentUrl(req: FastifyRequest): URL {
    const url = new URL(oidcRedirectUri(req));
    const query = req.url.indexOf('?');
    if (query >= 0) url.search = req.url.slice(query);
    return url;
  }

  /** The app redeems a handoff code; the session lands in its cookie jar. */
  async handoff(req: FastifyRequest, reply: FastifyReply, code: string) {
    const key = handoffKey(code);
    const handoff = (await this.cache.get(key)) as {
      userId: string;
      provider: string;
    } | null;
    // Single use, whether or not the rest works.
    await this.cache.delete(key);
    if (!handoff)
      throw new BadRequestException(
        'This sign-in link has expired. Try again.',
      );
    await this.sessions.create(reply, req, handoff.userId, handoff.provider);
  }

  // ── accounts ──────────────────────────────────────────────────────────────

  /**
   * The user for a checked identity, plus their profile and school. Returns
   * where to send them.
   */
  async signIn(
    identity: SsoIdentity,
    adapter: SsoAdapter,
    next: string | null,
  ): Promise<{ user: { id: string; email: string }; destination: string }> {
    const domain = await this.domains.verifiedDomainFor(identity.email);

    // A school that requires its own provider gets it; signing in with a
    // different one is refused rather than quietly allowed.
    if (
      domain?.ssoRequired &&
      domain.ssoProvider &&
      domain.ssoProvider !== adapter.id
    ) {
      const required = this.registry.get(domain.ssoProvider);
      throw new ForbiddenException(
        `Your school signs in with ${required?.label ?? 'its own provider'}`,
      );
    }

    const vouched =
      !!domain &&
      adapter.vouchesForDomain(identity, {
        domain: domain.domain,
        azureTenantId: domain.azureTenantId,
      });
    const emailTrusted = vouched || !!adapter.verifiesEmail?.(identity);

    const user = await this.accounts.userForIdentity(
      {
        provider: identity.provider,
        subject: identity.subject,
        email: identity.email,
        claims: identity.claims,
      },
      emailTrusted,
    );

    // An identity linked earlier may carry a different address than the
    // account now; the domain only counts when it is the account's own.
    const sameAddress = identity.email?.toLowerCase() === user.email;
    const destination = await this.provision(
      user,
      identity.profile,
      vouched && sameAddress ? domain : null,
      next,
    );
    return { user, destination };
  }

  /**
   * Make sure the user has a profile, and a school when their provider vouches
   * for a school domain. Returns the path to send them to.
   */
  async provision(
    user: { id: string; email: string },
    profile: SsoProfile,
    vouchedDomain: VerifiedDomain | null,
    next: string | null,
  ): Promise<string> {
    const existing = await this.prisma.user_profile.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        first_name: true,
        school_id: true,
        account_type: true,
      },
    });

    const accountType = this.accountTypeFor(vouchedDomain);

    if (!existing) {
      // Names only when we can also say what kind of account this is: a
      // profile with a name skips onboarding, which is where a shared or
      // unknown domain asks "student or staff".
      const complete = accountType !== null && !!profile.firstName;
      try {
        await this.prisma.user_profile.create({
          data: {
            id: user.id,
            email: user.email,
            ...(complete
              ? {
                  first_name: profile.firstName,
                  last_name: profile.lastName ?? '',
                  account_type: accountType,
                }
              : {}),
          },
        });
      } catch (error) {
        throw new Error(`profile insert: ${(error as Error).message}`, {
          cause: error,
        });
      }
      await this.cache.delete(`profile:${user.id}`);
      if (!complete) return '/onboard';
    } else if (!existing.first_name) {
      return '/onboard';
    }

    const alreadySeated = !!existing?.school_id;
    if (!alreadySeated && vouchedDomain) {
      // Same rules as signing up with an email code: the account type picks
      // student or staff, staff may need approval.
      await this.domains.tryAutoJoin(user.id, user.email);
    }

    return next ?? '/';
  }

  /** What a vouched domain makes the account; null when it cannot say. */
  private accountTypeFor(
    domain: VerifiedDomain | null,
  ): 'student' | 'staff' | null {
    if (domain?.audience === 'student') return 'student';
    if (domain?.audience === 'staff') return 'staff';
    return null;
  }

  /**
   * Names to prefill onboarding with, from the provider the user last signed
   * in through. Null for email-code accounts.
   */
  async suggestedProfile(userId: string): Promise<SsoProfile | null> {
    const identity = await this.prisma.identity.findFirst({
      where: { user_id: userId },
      orderBy: { last_used_at: 'desc' },
      select: { provider: true, claims: true },
    });
    if (!identity) return null;
    const adapter = this.registry.get(identity.provider);
    const claims = (identity.claims ?? {}) as Record<string, unknown>;
    return adapter ? adapter.profileFrom(claims) : null;
  }
}
