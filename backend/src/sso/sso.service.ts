import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { primaryOrigin } from '@/config/origins';
import {
  EmailDomainService,
  type VerifiedDomain,
} from '@/email-domain/email-domain.service';
import { SsoRegistry, info } from './sso.registry';
import type { SsoAdapter, SsoProfile, SsoProviderInfo } from './sso.types';

export type SsoPlatform = 'web' | 'mobile';

/** Where the mobile app picks up a finished sign-in. */
const MOBILE_RETURN = process.env.MOBILE_SSO_RETURN_URL || 'gradebook://sso';
const HANDOFF_TTL_S = 120;

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

/**
 * Sign-in through a school's identity provider, end to end.
 *
 * The browser goes provider -> our callback -> the app. Nothing about the
 * provider leaks past this service: the adapter starts the sign-in, reads the
 * profile, and says whether it vouches for the school domain; this service
 * turns that into a GradeBook profile and, when the domain is the school's,
 * a seat in the school - so a student with a school account never fills in a
 * form.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
    private readonly registry: SsoRegistry,
    private readonly domains: EmailDomainService,
    private readonly prisma: PrismaService,
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
    return {
      provider: adapter ? info(adapter) : null,
      required: !!(adapter && domain?.ssoRequired),
    };
  }

  private callbackUrl(
    req: FastifyRequest,
    params: Record<string, string>,
  ): string {
    const base =
      process.env.API_URL?.replace(/\/+$/, '') ||
      `${req.protocol}://${req.headers.host as string}`;
    return `${base}/api/auth/sso/callback?${new URLSearchParams(params).toString()}`;
  }

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

    const params: Record<string, string> = {
      provider: adapter.id,
      platform: input.platform === 'mobile' ? 'mobile' : 'web',
    };
    const next = safeNext(input.next);
    if (next) params.next = next;

    // The client keeps the PKCE verifier in a cookie on our domain, which the
    // callback reads back.
    const client = this.supabaseService.createUserClient(req, reply, 'public');
    try {
      return await adapter.start({
        client,
        redirectTo: this.callbackUrl(req, params),
        email,
        domain:
          domain?.ssoProvider === adapter.id
            ? domain.domain
            : email?.split('@')[1],
      });
    } catch (err) {
      this.logger.warn(
        `SSO start via ${adapter.id} failed: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `Could not start sign-in with ${adapter.label}`,
      );
    }
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
    const platform: SsoPlatform =
      query.platform === 'mobile' ? 'mobile' : 'web';
    const fail = (reason: string) =>
      platform === 'mobile'
        ? `${MOBILE_RETURN}?error=${encodeURIComponent(reason)}`
        : `${primaryOrigin()}/login?error=${encodeURIComponent(reason)}`;

    if (query.error || !query.code) {
      return fail(query.error_description || query.error || 'cancelled');
    }

    const client = this.supabaseService.createUserClient(req, reply, 'public');
    const { data, error } = await client.auth.exchangeCodeForSession(
      query.code,
    );
    if (error || !data.session || !data.user) {
      this.logger.warn(`SSO code exchange failed: ${error?.message}`);
      return fail('expired');
    }

    const adapter =
      this.registry.get(query.provider) ??
      this.registry.forIdentityProvider(data.user.app_metadata?.provider ?? '');
    if (!adapter) {
      await client.auth.signOut();
      return fail('provider');
    }

    let destination: string;
    try {
      destination = await this.provision(
        data.user,
        adapter,
        safeNext(query.next),
      );
    } catch (err) {
      await client.auth.signOut();
      const message =
        err instanceof ForbiddenException ? err.message : 'failed';
      if (!(err instanceof ForbiddenException)) {
        this.logger.error(`SSO provisioning failed: ${(err as Error).message}`);
      }
      return fail(message);
    }

    if (platform === 'mobile') {
      // The app has its own cookie jar; the browser's session cannot reach
      // it. Hand the tokens over once, briefly, by an unguessable code.
      const code = randomBytes(24).toString('base64url');
      await this.cache.set(
        `sso-handoff:${code}`,
        {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
        HANDOFF_TTL_S,
      );
      // The browser keeps no session; the app is the one signing in.
      await client.auth.signOut({ scope: 'local' });
      return `${MOBILE_RETURN}?code=${code}`;
    }

    return `${primaryOrigin()}${destination}`;
  }

  /** The app redeems a handoff code; the session lands in its cookie jar. */
  async handoff(req: FastifyRequest, reply: FastifyReply, code: string) {
    const key = `sso-handoff:${code}`;
    const tokens = (await this.cache.get(key)) as {
      accessToken: string;
      refreshToken: string;
    } | null;
    // Single use, whether or not the rest works.
    await this.cache.delete(key);
    if (!tokens)
      throw new BadRequestException(
        'This sign-in link has expired. Try again.',
      );

    const client = this.supabaseService.createUserClient(req, reply, 'public');
    const { error } = await client.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (error)
      throw new BadRequestException(
        'This sign-in link has expired. Try again.',
      );
  }

  /**
   * Make sure the user has a profile, and a school when their provider vouches
   * for a school domain. Returns the path to send them to.
   */
  async provision(
    user: User,
    adapter: SsoAdapter,
    next: string | null,
  ): Promise<string> {
    const domain = await this.domains.verifiedDomainFor(user.email);

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
      adapter.vouchesForDomain(user, {
        domain: domain.domain,
        azureTenantId: domain.azureTenantId,
      });

    const existing = await this.prisma.user_profile.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        first_name: true,
        school_id: true,
        account_type: true,
      },
    });

    const accountType = this.accountTypeFor(vouched ? domain : null);
    const profile = adapter.profileFrom(user);

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
    if (!alreadySeated && vouched) {
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
   * Names to prefill onboarding with, from the provider the user signed in
   * through. Empty for email-code accounts.
   */
  suggestedProfile(user: User): SsoProfile | null {
    const adapter = this.registry.forIdentityProvider(
      user.app_metadata?.provider ?? '',
    );
    return adapter ? adapter.profileFrom(user) : null;
  }
}
