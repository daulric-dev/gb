import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { MailService, redactEmail } from '@/mail/mail.service';
import { SessionService } from '@/account/session.service';
import { authSecret } from '@/account/secret';
import { CODE_LENGTH, normalizeEmail } from '@/account/email-code.service';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { isUniqueViolation } from '@/common/db-values';
import { emailChangeCodeEmail, emailChangedAlertEmail } from './email-change-emails';

/** How long a code to the new address works. */
export const EMAIL_CHANGE_TTL_MS = 15 * 60_000;
/** Wrong guesses at one code before it stops working. */
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
/** Codes one account may have sent in EMAIL_CHANGE_SEND_WINDOW_MS (any address). */
export const EMAIL_CHANGE_MAX_SENDS = 5;
export const EMAIL_CHANGE_SEND_WINDOW_MS = 60 * 60_000;

/** Keyed hash of a code, bound to the account and the new address. */
export function hashEmailChangeCode(userId: string, email: string, code: string): string {
  return createHmac('sha256', authSecret())
    .update(`email_change:${userId}:${normalizeEmail(email)}:${code}`)
    .digest('hex');
}

/**
 * Changing the email address an account signs in with (GDPR Art 16:
 * rectification), proven both ways:
 *
 * 1. `request` - the session confirmed it's them in the last ten minutes
 *    (step-up, checked by the route), and the new address is free and not on
 *    a domain whose school requires single sign-on. An 8-digit code goes to
 *    the NEW address. One pending change per account
 *    (`account.email_change`); asking again replaces it. At most
 *    EMAIL_CHANGE_MAX_SENDS codes an hour per account.
 * 2. `confirm` - the code (EMAIL_CHANGE_MAX_ATTEMPTS guesses, 15 minutes)
 *    swaps `app_user.email` and the profile's copy, signs out every other
 *    session, writes an audit entry (both addresses masked), and alerts the
 *    OLD address.
 *
 * Accounts on a domain whose school requires single sign-on cannot change
 * their address here: the school's identity provider owns it.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly emailDomains: EmailDomainService,
    private readonly audit: AuditLogService,
  ) {}

  /** The pending change, if any (the new address and when its code expires). */
  async pending(userId: string): Promise<{ email: string; expiresAt: string } | null> {
    const row = await this.prisma.email_change.findUnique({
      where: { user_id: userId },
      select: { new_email: true, expires_at: true },
    });
    if (!row || row.expires_at.getTime() <= Date.now()) return null;
    return { email: row.new_email, expiresAt: row.expires_at.toISOString() };
  }

  async cancel(userId: string): Promise<void> {
    await this.prisma.email_change.deleteMany({ where: { user_id: userId } });
  }

  async request(userId: string, rawEmail: string): Promise<{ email: string; expiresAt: string }> {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.app_user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, disabled_at: true },
    });
    if (!user || user.disabled_at) throw new NotFoundException('Account not found');
    if (email === normalizeEmail(user.email)) {
      throw new BadRequestException('That is already your email address');
    }
    await this.refuseIfSsoManaged(user.email, email);
    await this.refuseIfTaken(userId, email);

    // Expired requests from anyone are cleared as new ones arrive.
    await this.prisma.email_change
      .deleteMany({ where: { expires_at: { lt: new Date(Date.now() - EMAIL_CHANGE_SEND_WINDOW_MS) } } })
      .catch(() => undefined);

    const now = Date.now();
    const existing = await this.prisma.email_change.findUnique({
      where: { user_id: userId },
      select: { sends: true, window_started_at: true },
    });
    const inWindow =
      !!existing && now - existing.window_started_at.getTime() < EMAIL_CHANGE_SEND_WINDOW_MS;
    if (inWindow && existing.sends >= EMAIL_CHANGE_MAX_SENDS) {
      throw new HttpException(
        'Too many codes requested. Wait an hour and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    const expiresAt = new Date(now + EMAIL_CHANGE_TTL_MS);
    const fields = {
      new_email: email,
      code_hash: hashEmailChangeCode(userId, email, code),
      expires_at: expiresAt,
      attempts: 0,
      sends: inWindow ? existing.sends + 1 : 1,
      window_started_at: inWindow ? existing.window_started_at : new Date(now),
      created_at: new Date(now),
    };
    await this.prisma.email_change.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...fields },
      update: fields,
    });

    try {
      await this.mail.send({
        to: email,
        ...emailChangeCodeEmail(code, Math.round(EMAIL_CHANGE_TTL_MS / 60_000)),
      });
    } catch (err) {
      this.logger.error(`Email change code to ${redactEmail(email)} failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to send the code. Try again shortly.');
    }
    return { email, expiresAt: expiresAt.toISOString() };
  }

  async confirm(
    userId: string,
    currentSessionId: string | null | undefined,
    rawCode: string,
  ): Promise<{ email: string }> {
    const invalid = new UnauthorizedException('Invalid or expired code');
    const code = rawCode.trim();
    const row = await this.prisma.email_change.findUnique({
      where: { user_id: userId },
      select: { new_email: true, code_hash: true, expires_at: true, attempts: true },
    });
    if (!row || row.expires_at.getTime() <= Date.now() || row.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      throw invalid;
    }
    // Take the attempt first, conditional on one being left, so parallel
    // guesses cannot slip in on a stale count.
    const took = await this.prisma.email_change.updateMany({
      where: { user_id: userId, code_hash: row.code_hash, attempts: { lt: EMAIL_CHANGE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (took.count !== 1) throw invalid;
    const given = Buffer.from(hashEmailChangeCode(userId, row.new_email, code), 'hex');
    const expected = Buffer.from(row.code_hash, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid;

    const newEmail = row.new_email;
    const user = await this.prisma.app_user.findUnique({
      where: { id: userId },
      select: { email: true, disabled_at: true },
    });
    if (!user || user.disabled_at) throw invalid;
    const oldEmail = user.email;
    // Checked again: things may have changed since the code was sent.
    await this.refuseIfSsoManaged(oldEmail, newEmail);
    await this.refuseIfTaken(userId, newEmail);

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Used once: only the request that deletes the row goes on.
        const used = await tx.email_change.deleteMany({
          where: { user_id: userId, code_hash: row.code_hash },
        });
        if (used.count !== 1) throw invalid;
        await tx.app_user.update({
          where: { id: userId },
          data: { email: newEmail, email_verified_at: now, updated_at: now },
        });
        const profile = await tx.user_profile.findUnique({
          where: { id: userId },
          select: { school_id: true },
        });
        if (profile) {
          await tx.user_profile.update({ where: { id: userId }, data: { email: newEmail } });
        }
        // Masked: the audit log records that and when it changed, not the addresses.
        await this.audit.record(tx, profile?.school_id ?? null, { id: userId }, {
          entity: 'account_email',
          entityId: userId,
          action: 'update',
          changes: { email: { before: redactEmail(oldEmail), after: redactEmail(newEmail) } },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('That address belongs to another GradeBook account');
      }
      throw err;
    }

    // Every other device signs in again; this one's cached lookup (which
    // holds the old address) is dropped.
    if (currentSessionId) {
      await this.sessions.revokeOthers(userId, currentSessionId, 'email_changed');
      const current = await this.prisma.session
        .findUnique({
          where: { id: currentSessionId },
          select: { token_hash: true, previous_token_hash: true },
        })
        .catch(() => null);
      if (current) await this.sessions.purgeCached([current]);
    } else {
      await this.sessions.revokeAll(userId, 'email_changed');
    }
    await this.cache.delete(`profile:${userId}`).catch(() => undefined);

    // Best effort: the change is made whether or not the alert goes out.
    if (this.mail.configured()) {
      void this.mail
        .send({ to: oldEmail, ...emailChangedAlertEmail(redactEmail(newEmail), now) })
        .catch((err: Error) => this.logger.warn(`Email change alert failed: ${err.message}`));
    }
    this.logger.log(`Account ${userId} changed its email address`);
    return { email: newEmail };
  }

  /**
   * Single sign-on owns the address of an account on (or moving to) a
   * domain whose school requires it.
   */
  private async refuseIfSsoManaged(currentEmail: string, newEmail: string) {
    if (await this.emailDomains.ssoRequirement(currentEmail)) {
      throw new ForbiddenException(
        'Your school manages your sign-in, so your email address can only be changed by the school.',
      );
    }
    const required = await this.emailDomains.ssoRequirement(newEmail);
    if (required) {
      throw new ForbiddenException(
        `Addresses on that domain sign in with ${required.label}; they cannot be added here.`,
      );
    }
  }

  private async refuseIfTaken(userId: string, email: string) {
    const [account, profile] = await Promise.all([
      this.prisma.app_user.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.user_profile.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, id: { not: userId } },
        select: { id: true },
      }),
    ]);
    if ((account && account.id !== userId) || profile) {
      throw new ConflictException('That address belongs to another GradeBook account');
    }
  }
}
