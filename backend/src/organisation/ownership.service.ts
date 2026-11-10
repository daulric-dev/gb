import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { MailService } from '@/mail/mail.service';
import { primaryOrigin } from '@/config/origins';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { permCacheKey, userPermCachePrefix } from '@/permission/permission.effective';
import { isOrgAdmin } from './org-admin';
import { seatSchoolAdmin } from './school-admin';
import { ownershipEmail, type OwnershipEmailInput } from './ownership.email';

type Person = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  app_user?: { email: string; disabled_at?: Date | null } | null;
};

const PERSON_SELECT = {
  first_name: true,
  last_name: true,
  email: true,
  app_user: { select: { email: true, disabled_at: true } },
} as const;

const emailOf = (p: Person | null | undefined) => p?.app_user?.email ?? p?.email ?? '';
const nameOf = (p: Person | null | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
const labelOf = (p: Person | null | undefined) => nameOf(p) || emailOf(p) || 'someone';

export interface OwnerSummary {
  userId: string;
  name: string;
  email: string;
}

export interface SchoolTransferCandidate extends OwnerSummary {
  role: string | null;
}

/**
 * Handing over ownership so the owner can leave or delete their account
 * (src/auth/account-deletion.ts blocks owners).
 *
 * - The organisation: only its owner (organisation.owner_id), or any
 *   organisation admin while it has none, to another organisation admin with
 *   a stored row. The previous owner stays an organisation admin.
 * - A school: its owner, the holder of its admin seat while it has no owner,
 *   or an organisation admin, to a staff member of that school. A school has
 *   exactly one admin (partial unique index
 *   school_management_one_admin_per_school) and its owner holds that seat,
 *   so the transfer seats the new owner as admin through seatSchoolAdmin -
 *   the same code as appointing an admin - and the previous admin stays a
 *   member as a teacher.
 *
 * Both are audit-logged (organisation scope / the school's log) and email
 * both people when SMTP is set up. Routes require a recent step-up.
 */
@Injectable()
export class OwnershipService {
  private readonly logger = new Logger(OwnershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  // --- the organisation ----------------------------------------------------

  async transferOrganisation(actorId: string, targetId: string) {
    const org = await this.prisma.organisation.findFirst({
      select: { id: true, name: true, owner_id: true },
    });
    if (!org) throw new NotFoundException('GradeBook is not set up yet');

    const mayTransfer = org.owner_id
      ? org.owner_id === actorId
      : await isOrgAdmin(this.prisma, actorId);
    if (!mayTransfer) {
      throw new ForbiddenException(
        'Only the organisation owner can transfer ownership',
      );
    }
    if (org.owner_id === targetId) {
      throw new BadRequestException('They already own the organisation');
    }

    const target = await this.prisma.organisation_admin.findUnique({
      where: { user_id: targetId },
      select: { user_id: true, user_profile: { select: PERSON_SELECT } },
    });
    if (!target) {
      throw new BadRequestException(
        "Choose one of the organisation's administrators. Add them as an administrator first.",
      );
    }
    if (target.user_profile.app_user?.disabled_at) {
      throw new BadRequestException('That account is disabled');
    }

    await this.prisma.$transaction(async (tx) => {
      // Only if nobody changed it meanwhile.
      const { count } = await tx.organisation.updateMany({
        where: { id: org.id, owner_id: org.owner_id },
        data: { owner_id: targetId, updated_at: new Date() },
      });
      if (count === 0) {
        throw new ConflictException(
          'Ownership changed in the meantime. Reload and try again.',
        );
      }
      await this.auditLog?.record(
        tx,
        null,
        { id: actorId },
        {
          entity: 'organisation',
          entityId: org.id,
          action: 'update',
          changes: auditChanges({ owner_id: org.owner_id }, { owner_id: targetId }),
        },
      );
    });

    await Promise.all(
      [actorId, targetId].map((id) => this.cache.delete(`profile:${id}`)),
    );
    this.logger.log(
      `Organisation ownership moved from ${org.owner_id ?? '-'} to ${targetId} by ${actorId}`,
    );

    const actor = await this.person(actorId);
    const previous = org.owner_id ? await this.person(org.owner_id) : null;
    const base = {
      kind: 'organisation' as const,
      place: org.name,
      by: labelOf(actor),
      settingsUrl: `${primaryOrigin()}/organisation/settings`,
    };
    await this.notify(emailOf(target.user_profile), {
      ...base,
      recipient: 'new_owner',
      other: labelOf(previous),
    });
    if (previous) {
      await this.notify(emailOf(previous), {
        ...base,
        recipient: 'previous_owner',
        other: labelOf(target.user_profile),
      });
    }
    return {
      ownerId: targetId,
      owner: this.summary(targetId, target.user_profile),
    };
  }

  // --- a school ------------------------------------------------------------

  /** Who may hand this school over, or a 403/404. */
  private async requireSchoolTransferer(actorId: string, schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, owner_id: true },
    });
    if (!school) throw new NotFoundException('School not found');
    if (school.owner_id === actorId) return school;
    if (!school.owner_id) {
      const seat = await this.prisma.school_management.findFirst({
        where: { school_id: schoolId, role: 'admin' },
        select: { user_id: true },
      });
      if (seat?.user_id === actorId) return school;
    }
    if (await isOrgAdmin(this.prisma, actorId)) return school;
    throw new ForbiddenException(
      'Only the school owner or an organisation admin can transfer ownership',
    );
  }

  /** The school's owner and the staff it could be handed to. */
  async schoolCandidates(actorId: string, schoolId: string) {
    const school = await this.requireSchoolTransferer(actorId, schoolId);
    const [owner, members] = await Promise.all([
      school.owner_id
        ? this.prisma.user_profile.findUnique({
            where: { id: school.owner_id },
            select: PERSON_SELECT,
          })
        : Promise.resolve(null),
      this.prisma.school_management.findMany({
        where: {
          school_id: schoolId,
          user_profile: { account_type: 'staff' },
          ...(school.owner_id ? { user_id: { not: school.owner_id } } : {}),
        },
        select: {
          user_id: true,
          role: true,
          user_profile: { select: PERSON_SELECT },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    const candidates: SchoolTransferCandidate[] = members
      .filter((m) => !m.user_profile.app_user?.disabled_at)
      .map((m) => ({ ...this.summary(m.user_id, m.user_profile), role: m.role }));
    return {
      schoolId,
      schoolName: school.name ?? '',
      owner: school.owner_id && owner ? this.summary(school.owner_id, owner) : null,
      candidates,
    };
  }

  async transferSchool(actorId: string, schoolId: string, targetId: string) {
    const school = await this.requireSchoolTransferer(actorId, schoolId);
    if (school.owner_id === targetId) {
      throw new BadRequestException('They already own this school');
    }

    const membership = await this.prisma.school_management.findUnique({
      where: { user_id_school_id: { user_id: targetId, school_id: schoolId } },
      select: {
        id: true,
        role: true,
        user_profile: {
          select: { id: true, school_id: true, account_type: true, ...PERSON_SELECT },
        },
      },
    });
    const profile = membership?.user_profile;
    if (!membership || !profile || profile.account_type !== 'staff') {
      throw new BadRequestException('Choose a staff member of this school');
    }
    if (profile.app_user?.disabled_at) {
      throw new BadRequestException('That account is disabled');
    }

    let demoted: { id: string; user_id: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.school.findUnique({
        where: { id: schoolId },
        select: { owner_id: true },
      });
      if ((current?.owner_id ?? null) !== (school.owner_id ?? null)) {
        throw new ConflictException(
          'Ownership changed in the meantime. Reload and try again.',
        );
      }
      const seat = await tx.school_management.findFirst({
        where: { school_id: schoolId, role: 'admin' },
        select: { id: true, user_id: true },
      });
      demoted = seat && seat.user_id !== targetId ? seat : null;
      await seatSchoolAdmin(tx, { id: targetId, school_id: profile.school_id }, schoolId);

      const actor = { id: actorId };
      await this.auditLog?.record(tx, schoolId, actor, {
        entity: 'school',
        entityId: schoolId,
        action: 'update',
        changes: auditChanges({ owner_id: school.owner_id }, { owner_id: targetId }),
      });
      await this.auditLog?.record(tx, schoolId, actor, {
        entity: 'school_membership',
        entityId: membership.id,
        action: 'update',
        changes: auditChanges({ role: membership.role }, { role: 'admin' }),
      });
      if (demoted) {
        await this.auditLog?.record(tx, schoolId, actor, {
          entity: 'school_membership',
          entityId: demoted.id,
          action: 'update',
          changes: auditChanges({ role: 'admin' }, { role: 'teacher' }),
        });
      }
    });

    const demotedId = (demoted as { user_id: string } | null)?.user_id ?? null;
    const affected = [...new Set([targetId, demotedId, school.owner_id].filter(Boolean))] as string[];
    await Promise.all([
      this.cache.delete('schools:all'),
      ...affected.flatMap((id) => [
        this.cache.delete(`profile:${id}`),
        this.cache.delete(permCacheKey(id, schoolId)),
        this.cache.deleteByPrefix(userPermCachePrefix(id)),
      ]),
    ]);
    this.logger.log(
      `School ${schoolId} ownership moved from ${school.owner_id ?? '-'} to ${targetId} by ${actorId}`,
    );

    const actor = await this.person(actorId);
    const previous = school.owner_id ? await this.person(school.owner_id) : null;
    const base = {
      kind: 'school' as const,
      place: school.name?.trim() || 'your school',
      by: labelOf(actor),
      settingsUrl: `${primaryOrigin()}/dashboard/settings`,
    };
    await this.notify(emailOf(profile), {
      ...base,
      recipient: 'new_owner',
      other: labelOf(previous),
    });
    if (previous && school.owner_id !== targetId) {
      await this.notify(emailOf(previous), {
        ...base,
        recipient: 'previous_owner',
        other: labelOf(profile),
      });
    }
    return {
      schoolId,
      ownerId: targetId,
      owner: this.summary(targetId, profile),
      previousOwnerId: school.owner_id,
    };
  }

  // --- helpers -------------------------------------------------------------

  private summary(userId: string, p: Person): OwnerSummary {
    return { userId, name: nameOf(p), email: emailOf(p) };
  }

  private person(userId: string) {
    return this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: PERSON_SELECT })
      .catch(() => null);
  }

  /** Best effort: a transfer never fails because an email could not go. */
  private async notify(
    to: string,
    input: Omit<OwnershipEmailInput, 'other'> & { other: string },
  ) {
    if (!to || !this.mail?.configured()) return;
    try {
      await this.mail.send({ to, ...ownershipEmail(input) });
    } catch (err) {
      this.logger.warn(`Failed to email an ownership change: ${(err as Error).message}`);
    }
  }
}
