import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@/generated/prisma/client';
import { isUniqueViolation } from '@/common/db-values';
import { normalizeEmail } from './email-code.service';
import { SessionService } from './session.service';

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
 * falls back to the address when the provider vouches for it. A provider
 * that does not vouch for the address never creates a user: there would be
 * no telling whether the one signing in owns it.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  /** The user for a proven email address, created on first sign-in. */
  async userForVerifiedEmail(rawEmail: string): Promise<{ id: string; email: string }> {
    const email = normalizeEmail(rawEmail);
    const existing = await this.prisma.app_user.findUnique({
      where: { email },
      select: { id: true, email: true, disabled_at: true, email_verified_at: true },
    });

    if (existing) {
      if (existing.disabled_at) throw new ForbiddenException('This account is disabled');
      if (!existing.email_verified_at) await this.adoptUnverified(existing.id);
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
   * A user without `email_verified_at` predates the rule that SSO only
   * creates users for vouched-for addresses: an untrusted sign-in used to
   * create one. Whoever made that sign-in may not own the address, so before
   * the owner adopts it, its sessions end and its SSO identities are
   * unlinked, in one transaction. Nothing else is touched. The update is
   * conditional, so a concurrent adoption does this once.
   */
  private async adoptUnverified(userId: string): Promise<void> {
    const now = new Date();
    const live = await this.prisma.$transaction(async (tx) => {
      const verified = await tx.app_user.updateMany({
        where: { id: userId, email_verified_at: null },
        data: { email_verified_at: now },
      });
      if (verified.count !== 1) return [];

      const rows = await tx.session.findMany({
        where: { user_id: userId, revoked_at: null },
        select: { token_hash: true, previous_token_hash: true },
      });
      await tx.session.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: now, revoked_reason: 'email_verified' },
      });
      await tx.identity.deleteMany({ where: { user_id: userId } });
      return rows;
    });

    // Cached lookups would keep the ended sessions alive for up to a minute.
    await this.sessions.purgeCached(live);
  }

  /**
   * The user an SSO sign-in belongs to.
   *
   * `emailTrusted` is whether the provider vouches for the address. Without
   * it, an identity is only ever matched by (provider, subject): an
   * unverified address must never take over an existing account, nor create
   * one its owner would later find already set up.
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
    if (!emailTrusted) {
      const owner = await this.prisma.app_user.findUnique({
        where: { email },
        select: { id: true },
      });
      throw new ForbiddenException(
        owner
          ? 'An account with this email already exists. Sign in with an email code to link it.'
          : 'Your sign-in provider did not confirm this email address. Sign in with an email code instead.',
      );
    }

    const user = await this.userForVerifiedEmail(email);

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
