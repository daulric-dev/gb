import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@/generated/prisma/client';
import { isUniqueViolation } from '@/common/db-values';
import { normalizeEmail } from './email-code.service';

export interface LinkedIdentity {
  provider: string;
  subject: string;
  email: string | null;
  claims: Record<string, unknown>;
}

/**
 * Users of our own auth: one row per person, keyed by email, plus the SSO
 * identities linked to it.
 *
 * Signing in by email code proves the address, so it finds or creates the
 * user for that address. An SSO sign-in is matched by (provider, subject)
 * first - stable even if the address changes at the provider - and only
 * falls back to the address when the provider vouches for it.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user for a proven email address, created on first sign-in. */
  async userForVerifiedEmail(rawEmail: string): Promise<{ id: string; email: string }> {
    const email = normalizeEmail(rawEmail);
    const existing = await this.prisma.app_user.findUnique({
      where: { email },
      select: { id: true, email: true, disabled_at: true, email_verified_at: true },
    });

    if (existing) {
      if (existing.disabled_at) throw new ForbiddenException('This account is disabled');
      if (!existing.email_verified_at) {
        await this.prisma.app_user.update({
          where: { id: existing.id },
          data: { email_verified_at: new Date() },
        });
      }
      return { id: existing.id, email: existing.email };
    }

    try {
      return await this.prisma.app_user.create({
        data: { email, email_verified_at: new Date() },
        select: { id: true, email: true },
      });
    } catch (err) {
      // Two first sign-ins racing: the other one created it.
      if (!isUniqueViolation(err)) throw err;
      const user = await this.prisma.app_user.findUniqueOrThrow({
        where: { email },
        select: { id: true, email: true },
      });
      return user;
    }
  }

  /**
   * The user an SSO sign-in belongs to.
   *
   * `emailTrusted` is whether the provider vouches for the address. Without
   * it, an identity is only ever matched by (provider, subject) and a new
   * user is created only if the address is not already someone else's - an
   * unverified address must never take over an existing account.
   */
  async userForIdentity(
    identity: LinkedIdentity,
    emailTrusted: boolean,
  ): Promise<{ id: string; email: string }> {
    const linked = await this.prisma.identity.findUnique({
      where: { provider_subject: { provider: identity.provider, subject: identity.subject } },
      select: { id: true, app_user: { select: { id: true, email: true, disabled_at: true } } },
    });

    if (linked) {
      if (linked.app_user.disabled_at) throw new ForbiddenException('This account is disabled');
      await this.prisma.identity.update({
        where: { id: linked.id },
        data: {
          email: identity.email,
          claims: identity.claims as Prisma.InputJsonObject,
          last_used_at: new Date(),
        },
      });
      return { id: linked.app_user.id, email: linked.app_user.email };
    }

    if (!identity.email) {
      throw new ForbiddenException('Your sign-in provider did not share an email address');
    }
    const email = normalizeEmail(identity.email);
    const owner = await this.prisma.app_user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (owner && !emailTrusted) {
      throw new ForbiddenException(
        'An account with this email already exists. Sign in with an email code to link it.',
      );
    }

    const user = owner
      ? await this.prisma.app_user.findUniqueOrThrow({
          where: { id: owner.id },
          select: { id: true, email: true },
        })
      : emailTrusted
        ? await this.userForVerifiedEmail(email)
        : // Signed in, but the address is only the provider's say-so.
          await this.prisma.app_user.create({
            data: { email },
            select: { id: true, email: true },
          });

    await this.prisma.identity.create({
      data: {
        user_id: user.id,
        provider: identity.provider,
        subject: identity.subject,
        email,
        claims: identity.claims as Prisma.InputJsonObject,
      },
    });
    return user;
  }
}
