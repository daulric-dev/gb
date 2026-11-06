import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { MailService } from '@/mail/mail.service';
import { AccountService } from '@/account/account.service';
import { normalizeEmail } from '@/account/email-code.service';
import { primaryOrigin } from '@/config/origins';
import { isUniqueViolation } from '@/common/db-values';
import {
  permCacheKey,
  userPermCachePrefix,
} from '@/permission/permission.effective';
import { seatSchoolAdmin } from './school-admin';
import { inviteEmail } from './invite.email';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';

export const INVITE_KINDS = ['school_admin', 'organisation_admin'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

/** An invite lasts 14 days from when it was sent or last resent. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** What appointing or adding by an unknown email answers with. */
export interface InviteSummary {
  id: string;
  email: string;
  expiresAt: string;
}

/** GET /organisation/invites. */
export interface InviteRow extends InviteSummary {
  kind: InviteKind;
  school: { id: string; name: string } | null;
  invitedBy: { userId: string; email: string; name: string } | null;
  createdAt: string;
  /** Past expiresAt: sign-in ignores it until it is resent. */
  expired: boolean;
}

/** Neither accepted nor revoked (it may still have expired). */
const OPEN = { accepted_at: null, revoked_at: null } as const;

const INVITE_SELECT = {
  id: true,
  email: true,
  kind: true,
  school_id: true,
  created_at: true,
  expires_at: true,
  school: { select: { id: true, name: true } },
  inviter: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      app_user: { select: { email: true } },
    },
  },
} as const;

type Profile = {
  first_name: string | null;
  last_name: string | null;
};
const displayName = (p: Profile | null | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();

/**
 * Invites for people who have no account yet: a school's admin, or an
 * organisation admin. The first sign-in that proves the invited email
 * applies every open, unexpired invite for it (registered as a verified
 * sign-in hook on AccountService at boot).
 */
@Injectable()
export class InviteService implements OnModuleInit {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
    private readonly accounts: AccountService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  onModuleInit() {
    this.accounts.onVerifiedSignIn(async (user) => {
      await this.acceptFor(user);
    });
  }

  // --- sending -------------------------------------------------------------

  /**
   * Invite `rawEmail`. A school has one admin, so a new school_admin invite
   * revokes the school's other open one; an organisation_admin invite
   * replaces the same email's open one. Emails it when SMTP is set up.
   */
  async invite(
    actorId: string,
    kind: InviteKind,
    rawEmail: string,
    schoolId: string | null = null,
  ): Promise<InviteSummary> {
    const email = normalizeEmail(rawEmail);
    const now = new Date();
    let created: { id: string; email: string; expires_at: Date };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const where =
          kind === 'school_admin'
            ? { kind, school_id: schoolId, ...OPEN }
            : { kind, email, ...OPEN };
        const replaced = this.auditLog
          ? await tx.organisation_invite.findMany({
              where,
              select: { id: true, school_id: true, revoked_at: true },
            })
          : [];
        await tx.organisation_invite.updateMany({
          where,
          data: { revoked_at: now },
        });
        const invite = await tx.organisation_invite.create({
          data: {
            email,
            kind,
            school_id: kind === 'school_admin' ? schoolId : null,
            invited_by: actorId,
            created_at: now,
            expires_at: new Date(now.getTime() + INVITE_TTL_MS),
          },
          select: { id: true, email: true, expires_at: true },
        });
        for (const previous of replaced) {
          await this.auditLog?.record(
            tx,
            previous.school_id,
            { id: actorId },
            {
              entity: 'organisation_invite',
              entityId: previous.id,
              action: 'update',
              changes: auditChanges(
                { revoked_at: previous.revoked_at },
                { revoked_at: now },
              ),
            },
          );
        }
        await this.auditLog?.record(
          tx,
          kind === 'school_admin' ? schoolId : null,
          { id: actorId },
          {
            entity: 'organisation_invite',
            entityId: invite.id,
            action: 'create',
            changes: auditChanges(null, {
              email,
              kind,
              school_id: kind === 'school_admin' ? schoolId : null,
              expires_at: invite.expires_at,
            }),
          },
        );
        return invite;
      });
    } catch (err) {
      // Two admins inviting for the same school (or email) at once.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'An invite was just sent for this. Refresh and try again.',
        );
      }
      throw err;
    }
    this.logger.log(
      `Organisation admin ${actorId} invited a ${kind}` +
        (schoolId ? ` for ${schoolId}` : '') +
        ` (invite ${created.id})`,
    );
    await this.sendEmail(created.id);
    return {
      id: created.id,
      email: created.email,
      expiresAt: created.expires_at.toISOString(),
    };
  }

  /** Open invites (newest first), optionally of one kind. */
  async list(kind?: InviteKind): Promise<InviteRow[]> {
    const rows = await this.prisma.organisation_invite.findMany({
      where: { ...OPEN, ...(kind ? { kind } : {}) },
      select: INVITE_SELECT,
      orderBy: { created_at: 'desc' },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      kind: r.kind as InviteKind,
      school: r.school ? { id: r.school.id, name: r.school.name ?? '' } : null,
      invitedBy: r.inviter
        ? {
            userId: r.inviter.id,
            email: r.inviter.app_user?.email ?? r.inviter.email ?? '',
            name: displayName(r.inviter),
          }
        : null,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      expired: r.expires_at.getTime() <= now,
    }));
  }

  /** Cancel an open invite; 404 once it is accepted or revoked. */
  async revoke(actorId: string, id: string) {
    const revokedAt = new Date();
    const { count } = await this.prisma.$transaction(async (tx) => {
      const invite = this.auditLog
        ? await tx.organisation_invite.findUnique({
            where: { id },
            select: { id: true, school_id: true, revoked_at: true },
          })
        : null;
      const { count } = await tx.organisation_invite.updateMany({
        where: { id, ...OPEN },
        data: { revoked_at: revokedAt },
      });
      if (count > 0 && invite) {
        await this.auditLog?.record(
          tx,
          invite.school_id,
          { id: actorId },
          {
            entity: 'organisation_invite',
            entityId: id,
            action: 'update',
            changes: auditChanges(
              { revoked_at: invite.revoked_at },
              { revoked_at: revokedAt },
            ),
          },
        );
      }
      return { count };
    });
    if (count === 0) throw new NotFoundException('Invite not found');
    this.logger.log(`Organisation admin ${actorId} revoked invite ${id}`);
    return { revoked: true };
  }

  /** Give an open invite (expired or not) a fresh 14 days and email it again. */
  async resend(actorId: string, id: string): Promise<InviteSummary> {
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const { count } = await this.prisma.$transaction(async (tx) => {
      const invite = this.auditLog
        ? await tx.organisation_invite.findUnique({
            where: { id },
            select: { id: true, school_id: true, expires_at: true },
          })
        : null;
      const { count } = await tx.organisation_invite.updateMany({
        where: { id, ...OPEN },
        data: { expires_at: expiresAt },
      });
      if (count > 0 && invite) {
        await this.auditLog?.record(
          tx,
          invite.school_id,
          { id: actorId },
          {
            entity: 'organisation_invite',
            entityId: id,
            action: 'update',
            changes: auditChanges(
              { expires_at: invite.expires_at },
              { expires_at: expiresAt },
            ),
          },
        );
      }
      return { count };
    });
    if (count === 0) throw new NotFoundException('Invite not found');
    const invite = await this.prisma.organisation_invite.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, expires_at: true },
    });
    this.logger.log(`Organisation admin ${actorId} resent invite ${id}`);
    await this.sendEmail(id);
    return {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expires_at.toISOString(),
    };
  }

  /** Each school's open admin invite (expired ones included), by school id. */
  async pendingForSchools(
    schoolIds: string[],
  ): Promise<Map<string, InviteSummary>> {
    if (schoolIds.length === 0) return new Map();
    const rows = await this.prisma.organisation_invite.findMany({
      where: { kind: 'school_admin', school_id: { in: schoolIds }, ...OPEN },
      select: { id: true, email: true, school_id: true, expires_at: true },
    });
    return new Map(
      rows.map((r) => [
        r.school_id!,
        { id: r.id, email: r.email, expiresAt: r.expires_at.toISOString() },
      ]),
    );
  }

  /** An account was added directly: its open organisation admin invite is moot. */
  async revokeOrganisationAdminInvite(rawEmail: string) {
    await this.prisma.organisation_invite.updateMany({
      where: {
        kind: 'organisation_admin',
        email: normalizeEmail(rawEmail),
        ...OPEN,
      },
      data: { revoked_at: new Date() },
    });
  }

  // --- accepting -----------------------------------------------------------

  /**
   * Apply every open, unexpired invite for a just-verified email, in one
   * transaction: a school_admin invite seats them as that school's admin
   * (the previous admin becomes a teacher), an organisation_admin invite
   * gives them a row in organisation_admin. Each is marked accepted. A
   * student account is never made a school's admin: that invite stays open.
   * Only called for verified emails (AccountService.userForVerifiedEmail);
   * errors are the caller's to log, so sign-in carries on.
   */
  async acceptFor(user: { id: string; email: string }): Promise<number> {
    const email = normalizeEmail(user.email);
    const now = new Date();
    const invites = await this.prisma.organisation_invite.findMany({
      where: { email, ...OPEN, expires_at: { gt: now } },
      select: { id: true, kind: true, school_id: true, invited_by: true },
      orderBy: { created_at: 'asc' },
    });
    if (invites.length === 0) return 0;

    const existing = await this.prisma.user_profile.findUnique({
      where: { id: user.id },
      select: { id: true, school_id: true, account_type: true },
    });
    const isStudent = existing?.account_type === 'student';
    const applicable = invites.filter((invite) => {
      if (invite.kind !== 'school_admin' || !isStudent) return true;
      this.logger.warn(
        `Invite ${invite.id}: ${user.id} is a student account and cannot run school ${invite.school_id}; left open`,
      );
      return false;
    });
    if (applicable.length === 0) return 0;

    const seated: { schoolId: string; demoted: string | null }[] = [];
    let orgAdmin = false;
    await this.prisma.$transaction(async (tx) => {
      // Both admin tables reference the profile; a first sign-in has none yet
      // (sign-in creates it next and keeps this one).
      let profile = existing;
      if (!profile) {
        profile = await tx.user_profile.create({
          data: { id: user.id, email },
          select: { id: true, school_id: true, account_type: true },
        });
      }

      for (const invite of applicable) {
        // Claim it first, so a concurrent sign-in applies it once.
        const claimed = await tx.organisation_invite.updateMany({
          where: { id: invite.id, ...OPEN },
          data: { accepted_at: now, accepted_by: user.id },
        });
        if (claimed.count !== 1) continue;
        await this.auditLog?.record(
          tx,
          invite.school_id,
          { id: user.id },
          {
            entity: 'organisation_invite',
            entityId: invite.id,
            action: 'update',
            changes: auditChanges(
              { accepted_at: null, accepted_by: null },
              { accepted_at: now, accepted_by: user.id },
            ),
          },
        );

        if (invite.kind === 'school_admin' && invite.school_id) {
          const currentAdmin = this.auditLog
            ? await tx.school_management.findFirst({
                where: { school_id: invite.school_id, role: 'admin' },
                select: { id: true, user_id: true, role: true },
              })
            : null;
          const existingMembership = this.auditLog
            ? await tx.school_management.findUnique({
                where: {
                  user_id_school_id: {
                    user_id: user.id,
                    school_id: invite.school_id,
                  },
                },
                select: { id: true, role: true },
              })
            : null;
          const openSchoolInvites = this.auditLog
            ? await tx.organisation_invite.findMany({
                where: {
                  school_id: invite.school_id,
                  kind: 'school_admin',
                  ...OPEN,
                },
                select: { id: true, revoked_at: true },
              })
            : [];
          const demoted = await seatSchoolAdmin(
            tx,
            profile,
            invite.school_id,
            now,
          );
          seated.push({ schoolId: invite.school_id, demoted });
          if (currentAdmin && currentAdmin.user_id !== user.id) {
            await this.auditLog?.record(
              tx,
              invite.school_id,
              { id: user.id },
              {
                entity: 'school_membership',
                entityId: currentAdmin.id,
                action: 'update',
                changes: auditChanges(
                  { user_id: currentAdmin.user_id, role: currentAdmin.role },
                  { user_id: currentAdmin.user_id, role: 'teacher' },
                ),
              },
            );
          }
          if (this.auditLog) {
            const membership = await tx.school_management.findUnique({
              where: {
                user_id_school_id: {
                  user_id: user.id,
                  school_id: invite.school_id,
                },
              },
              select: { id: true },
            });
            if (membership) {
              await this.auditLog.record(
                tx,
                invite.school_id,
                { id: user.id },
                {
                  entity: 'school_membership',
                  entityId: membership.id,
                  action: existingMembership ? 'update' : 'create',
                  changes: auditChanges(
                    existingMembership
                      ? {
                          user_id: user.id,
                          school_id: invite.school_id,
                          role: existingMembership.role,
                        }
                      : null,
                    {
                      user_id: user.id,
                      school_id: invite.school_id,
                      role: 'admin',
                    },
                  ),
                },
              );
            }
          }
          for (const replaced of openSchoolInvites) {
            await this.auditLog?.record(
              tx,
              invite.school_id,
              { id: user.id },
              {
                entity: 'organisation_invite',
                entityId: replaced.id,
                action: 'update',
                changes: auditChanges(
                  { revoked_at: replaced.revoked_at },
                  { revoked_at: now },
                ),
              },
            );
          }
          if (!profile.school_id)
            profile = { ...profile, school_id: invite.school_id };
        } else if (invite.kind === 'organisation_admin') {
          const has = await tx.organisation_admin.findUnique({
            where: { user_id: user.id },
            select: { user_id: true },
          });
          if (!has) {
            await tx.organisation_admin.create({
              data: { user_id: user.id, created_by: invite.invited_by },
            });
            await this.auditLog?.record(
              tx,
              null,
              { id: user.id },
              {
                entity: 'organisation_admin',
                entityId: user.id,
                action: 'create',
                changes: auditChanges(null, {
                  user_id: user.id,
                  created_by: invite.invited_by,
                }),
              },
            );
          }
          orgAdmin = true;
        }
      }
    });

    const clears: Promise<unknown>[] = [
      this.cache.delete(`profile:${user.id}`),
    ];
    for (const { schoolId, demoted } of seated) {
      clears.push(this.cache.delete(permCacheKey(user.id, schoolId)));
      if (demoted) {
        clears.push(
          this.cache.delete(`profile:${demoted}`),
          this.cache.delete(permCacheKey(demoted, schoolId)),
        );
      }
    }
    if (orgAdmin)
      clears.push(this.cache.deleteByPrefix(userPermCachePrefix(user.id)));
    if (seated.length > 0) clears.push(this.cache.delete('schools:all'));
    await Promise.all(clears);

    const applied = seated.length + (orgAdmin ? 1 : 0);
    if (applied > 0) {
      this.logger.log(
        `Applied ${applied} invite(s) for ${user.id}` +
          (seated.length
            ? `: admin of ${seated.map((s) => s.schoolId).join(', ')}`
            : '') +
          (orgAdmin ? '; organisation admin' : ''),
      );
    }
    return applied;
  }

  // --- email ---------------------------------------------------------------

  /** Email the invite. Skipped without SMTP; a failure is only logged. */
  private async sendEmail(id: string): Promise<void> {
    try {
      if (!this.mail.configured()) {
        this.logger.log(
          `Email is not configured; invite ${id} was not emailed`,
        );
        return;
      }
      const invite = await this.prisma.organisation_invite.findUnique({
        where: { id },
        select: INVITE_SELECT,
      });
      if (!invite) return;
      const kind = invite.kind as InviteKind;
      const place =
        kind === 'school_admin'
          ? invite.school?.name || 'a school'
          : (
              await this.prisma.organisation.findFirst({
                select: { name: true },
              })
            )?.name || 'your organisation';
      const inviter = invite.inviter
        ? displayName(invite.inviter) ||
          invite.inviter.app_user?.email ||
          invite.inviter.email ||
          null
        : null;
      await this.mail.send({
        to: invite.email,
        ...inviteEmail({
          kind,
          place,
          inviter,
          expiresAt: invite.expires_at,
          signInUrl: `${primaryOrigin()}/login`,
        }),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to email invite ${id}: ${(err as Error).message}`,
      );
    }
  }
}
