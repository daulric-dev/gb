import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { SessionService } from '@/account/session.service';
import { normalizeEmail } from '@/account/email-code.service';
import { isUniqueViolation } from '@/common/db-values';
import {
  permCacheKey,
  userPermCachePrefix,
} from '@/permission/permission.effective';
import type { Prisma } from '@/generated/prisma/client';
import {
  isEnvOrgAdmin,
  organisationSummary,
  orgAdminEmails,
} from './org-admin';
import type {
  CreateOrganisationSchoolDto,
  UpdateOrganisationSchoolDto,
} from './dto/organisation.dto';
import { InviteService, type InviteSummary } from './invite.service';
import { seatSchoolAdmin } from './school-admin';
import { seedSchoolSystemRoles } from '@/permission/system-roles';
import { optionalImageUrl } from '@/images/public-url';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { textSearch } from '@/common/text-search';

export const SETUP_REFUSED =
  'Only a school administrator on this server, or an email listed in ' +
  'ORG_ADMIN_EMAILS, can finish setting up GradeBook. Sign in as one, or add ' +
  'your email to ORG_ADMIN_EMAILS and restart the server.';

export interface OrganisationAdminRow {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  fromEnv: boolean;
  /** The organisation's owner (organisation.owner_id). */
  isOwner: boolean;
  /**
   * Has a row in public.organisation_admin (false = only listed in
   * ORG_ADMIN_EMAILS). Only stored admins can be given ownership.
   */
  stored: boolean;
}

export interface OrganisationSchoolRow {
  id: string;
  name: string;
  code: string | null;
  schoolType: string | null;
  isActive: boolean;
  createdAt: string | null;
  admin: { userId: string; email: string; name: string } | null;
  /** school.owner_id: who must hand the school over before deleting their account. */
  ownerId: string | null;
  staffCount: number;
  studentCount: number;
  /** The open admin invite while nobody with an account was appointed. */
  pendingAdminInvite: InviteSummary | null;
}

/**
 * Creating a school or appointing its admin: the school's row, plus the
 * invite sent when no account uses the email (null when appointed directly).
 */
export type AppointedSchoolRow = OrganisationSchoolRow & {
  invited: InviteSummary | null;
};

/** Adding an organisation admin: their row, or the invite sent instead. */
export type AddedAdmin =
  (OrganisationAdminRow & { invited: null }) | { invited: InviteSummary };

export interface OrganisationSchoolDetail extends OrganisationSchoolRow {
  logoUrl: string | null;
}

type Profile = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

const displayName = (p: Profile | null | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();

/**
 * The organisation that runs this install, its admins and its schools.
 * Setup is open to the right first user; everything else is for organisation
 * admins (OrganisationAdminGuard).
 */
@Injectable()
export class OrganisationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrganisationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly sessions: SessionService,
    private readonly invites: InviteService,
    private readonly auditLog?: AuditLogService,
  ) {}

  /** Warn once at boot when the first sign-in could claim the install. */
  async onApplicationBootstrap(): Promise<void> {
    await this.warnIfSetupUnguarded();
  }

  /**
   * In production with ORG_ADMIN_EMAILS unset, an install with no
   * organisation and no schools lets whoever signs in first run setup and
   * become organisation admin (the documented first-run flow). That is fine
   * on a fresh server you are about to set up yourself, and dangerous on one
   * reachable by anyone else, so say so loudly. Behaviour is unchanged.
   */
  async warnIfSetupUnguarded(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    if (orgAdminEmails().size > 0) return;
    try {
      const [organisations, schools] = await Promise.all([
        this.prisma.organisation.count(),
        this.prisma.school.count(),
      ]);
      if (organisations > 0 || schools > 0) return;
    } catch (error) {
      this.logger.debug(
        `Skipped the setup check: ${(error as Error).message}`,
      );
      return;
    }
    this.logger.warn(
      'GradeBook is not set up and ORG_ADMIN_EMAILS is unset: the first ' +
        'account to sign in will claim the organisation and become its ' +
        'admin. Set ORG_ADMIN_EMAILS to the email(s) allowed to run setup ' +
        'and restart the server.',
    );
  }

  // --- setup ---------------------------------------------------------------

  /**
   * Public: whether setup is pending, and the organisation's name for the
   * install's home page (null before setup). Nothing else is exposed.
   */
  async status() {
    const organisation = await organisationSummary(this.prisma);
    return { needsSetup: organisation === null, organisation };
  }

  /**
   * Create the organisation and make the caller its first admin, together.
   * With ORG_ADMIN_EMAILS set only those accounts may; on an install that
   * already has schools (an upgrade) only someone who owns or administers
   * one may, so a stranger who signs up first cannot take it over.
   */
  /**
   * Whether this signed-in user still has setup to do and may do it, so the
   * client sends them straight to /setup instead of letting them wander in.
   */
  async eligibility(userId: string) {
    const needsSetup = (await this.prisma.organisation.count()) === 0;
    return {
      needsSetup,
      canSetUp: needsSetup && (await this.maySetUp(userId)),
    };
  }

  /**
   * Who may run first-run setup: with ORG_ADMIN_EMAILS set, only a listed
   * verified email; otherwise anyone on an install with no schools, and on an
   * install that already has schools only someone who owns or runs one.
   */
  private async maySetUp(userId: string): Promise<boolean> {
    const listed = await isEnvOrgAdmin(this.prisma, userId);
    if (orgAdminEmails().size > 0) return listed;
    if (listed || (await this.prisma.school.count()) === 0) return true;
    const [owned, administered] = await Promise.all([
      this.prisma.school.count({ where: { owner_id: userId } }),
      this.prisma.school_management.count({
        where: { user_id: userId, role: 'admin' },
      }),
    ]);
    return owned > 0 || administered > 0;
  }

  async setup(userId: string, organisationName: string) {
    const name = organisationName.trim();
    if (!name) throw new BadRequestException('Organisation name is required');

    if ((await this.prisma.organisation.count()) > 0) {
      throw new ConflictException('GradeBook is already set up');
    }

    if (!(await this.maySetUp(userId))) {
      throw new ForbiddenException(SETUP_REFUSED);
    }

    const account = await this.prisma.app_user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    let org: { id: string; name: string; created_at: Date };
    try {
      org = await this.prisma.$transaction(async (tx) => {
        // Re-checked in the transaction; two setups racing past it are
        // settled by the organisation_singleton unique index (P2002 below).
        if ((await tx.organisation.count()) > 0) {
          throw new ConflictException('GradeBook is already set up');
        }
        // organisation.owner_id and organisation_admin reference the
        // profile; make sure it exists.
        await tx.user_profile.upsert({
          where: { id: userId },
          create: { id: userId, email: account?.email ?? null },
          update: {},
        });
        // Whoever runs setup owns the organisation (owner_id; see
        // POST /organisation/transfer-ownership to hand it on).
        const created = await tx.organisation.create({
          data: { name, owner_id: userId },
        });
        await tx.organisation_admin.upsert({
          where: { user_id: userId },
          create: { user_id: userId, created_by: userId },
          update: {},
        });
        await this.auditLog?.record(
          tx,
          null,
          { id: userId },
          {
            entity: 'organisation',
            entityId: created.id,
            action: 'create',
            changes: auditChanges(null, { name: created.name }),
          },
        );
        return created;
      });
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      // Another setup won between our check and the insert.
      if (isUniqueViolation(err)) {
        throw new ConflictException('GradeBook is already set up');
      }
      throw err;
    }

    this.logger.log(`Organisation set up by ${userId}`);
    // Every profile carries the organisation's name.
    await this.cache.deleteByPrefix('profile:');
    return this.orgDto(org);
  }

  // --- the organisation ----------------------------------------------------

  async get() {
    const org = await this.prisma.organisation.findFirst();
    if (!org) throw new NotFoundException('GradeBook is not set up yet');
    return this.orgDto(org);
  }

  async rename(name: string, actorId?: string) {
    const org = await this.prisma.organisation.findFirst({
      select: { id: true },
    });
    if (!org) throw new NotFoundException('GradeBook is not set up yet');
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.organisation.findUniqueOrThrow({
        where: { id: org.id },
      });
      const result = await tx.organisation.update({
        where: { id: org.id },
        data: { name: name.trim(), updated_at: new Date() },
      });
      if (actorId) {
        await this.auditLog?.record(
          tx,
          null,
          { id: actorId },
          {
            entity: 'organisation',
            entityId: org.id,
            action: 'update',
            changes: auditChanges({ name: before.name }, { name: result.name }),
          },
        );
      }
      return result;
    });
    await this.cache.deleteByPrefix('profile:');
    return this.orgDto(updated);
  }

  async overview() {
    const [schools, activeSchools, staff, students] = await Promise.all([
      this.prisma.school.count(),
      this.prisma.school.count({ where: { is_active: true } }),
      this.prisma.user_profile.count({
        where: { account_type: 'staff', school_management: { some: {} } },
      }),
      this.prisma.student.count({ where: { school_id: { not: null } } }),
    ]);
    return { schools, activeSchools, staff, students };
  }

  private orgDto(org: {
    id: string;
    name: string;
    created_at: Date;
    owner_id?: string | null;
  }) {
    return {
      id: org.id,
      name: org.name,
      createdAt: org.created_at.toISOString(),
      /** The owner's user id (null on an install with no stored admins). */
      ownerId: org.owner_id ?? null,
    };
  }

  // --- admins --------------------------------------------------------------

  /** Admins with a row, plus accounts listed in ORG_ADMIN_EMAILS (fromEnv). */
  async admins(): Promise<OrganisationAdminRow[]> {
    const emails = [...orgAdminEmails()];
    const [org, rows, envUsers] = await Promise.all([
      this.prisma.organisation.findFirst({ select: { owner_id: true } }),
      this.prisma.organisation_admin.findMany({
        select: {
          user_id: true,
          created_at: true,
          user_profile: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
              app_user: { select: { email: true } },
            },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
      emails.length === 0
        ? Promise.resolve([])
        : this.prisma.app_user.findMany({
            where: {
              email: { in: emails },
              email_verified_at: { not: null },
              disabled_at: null,
            },
            select: {
              id: true,
              email: true,
              created_at: true,
              user_profile: {
                select: { first_name: true, last_name: true, email: true },
              },
            },
          }),
    ]);

    const envIds = new Set(envUsers.map((u) => u.id));
    const list: OrganisationAdminRow[] = rows.map((r) => ({
      userId: r.user_id,
      email: r.user_profile.app_user?.email ?? r.user_profile.email ?? '',
      name: displayName(r.user_profile),
      createdAt: r.created_at.toISOString(),
      fromEnv: envIds.has(r.user_id),
      isOwner: r.user_id === org?.owner_id,
      stored: true,
    }));
    const listed = new Set(list.map((a) => a.userId));
    for (const u of envUsers) {
      if (listed.has(u.id)) continue;
      list.push({
        userId: u.id,
        email: u.email,
        name: displayName(u.user_profile),
        createdAt: u.created_at.toISOString(),
        fromEnv: true,
        isOwner: u.id === org?.owner_id,
        stored: false,
      });
    }
    return list;
  }

  /**
   * Make an existing account an organisation admin. With no account for the
   * email, invite it instead: it becomes an admin at its first verified
   * sign-in.
   */
  async addAdmin(actorId: string, email: string): Promise<AddedAdmin> {
    const user = await this.findUserByEmail(email);
    if (!user) {
      return {
        invited: await this.invites.invite(
          actorId,
          'organisation_admin',
          email,
        ),
      };
    }
    await this.invites.revokeOrganisationAdminInvite(email);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.organisation_admin.findUnique({
        where: { user_id: user.id },
      });
      await tx.organisation_admin.upsert({
        where: { user_id: user.id },
        create: { user_id: user.id, created_by: actorId },
        update: {},
      });
      if (!existing) {
        await this.auditLog?.record(
          tx,
          null,
          { id: actorId },
          {
            entity: 'organisation_admin',
            entityId: user.id,
            action: 'create',
            changes: auditChanges(null, { user_id: user.id }),
          },
        );
      }
    });
    // Organisation admins administer every school: drop their cached sets.
    await Promise.all([
      this.cache.delete(`profile:${user.id}`),
      this.cache.deleteByPrefix(userPermCachePrefix(user.id)),
    ]);
    this.logger.log(`Organisation admin ${actorId} added ${user.id}`);
    const added = (await this.admins()).find((a) => a.userId === user.id);
    return { ...added!, invited: null };
  }

  /**
   * Remove an admin's row. Refused when nobody else would be left to run the
   * organisation; accounts from ORG_ADMIN_EMAILS only go by editing the env.
   */
  async removeAdmin(actorId: string, userId: string) {
    const all = await this.admins();
    const target = all.find((a) => a.userId === userId);
    if (!target) throw new NotFoundException('Organisation admin not found');
    if (target.isOwner) {
      throw new BadRequestException(
        'The organisation owner cannot be removed. Transfer ownership first.',
      );
    }

    const row = await this.prisma.organisation_admin.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });
    if (!row) {
      throw new BadRequestException(
        'This admin comes from ORG_ADMIN_EMAILS; remove them there instead.',
      );
    }
    // At least one admin must come from the database, not only from
    // ORG_ADMIN_EMAILS. A listed account stays an admin without its row, so
    // removing that row is always allowed.
    const othersFromDb = all.filter((a) => a.userId !== userId && !a.fromEnv);
    if (!target.fromEnv && othersFromDb.length === 0) {
      throw new BadRequestException(
        userId === actorId
          ? 'You are the last organisation admin. Add another admin before removing yourself.'
          : 'GradeBook needs at least one organisation admin.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.organisation_admin.deleteMany({
        where: { user_id: userId },
      });
      if (deleted.count > 0) {
        await this.auditLog?.record(
          tx,
          null,
          { id: actorId },
          {
            entity: 'organisation_admin',
            entityId: userId,
            action: 'delete',
            changes: auditChanges({ user_id: userId }, null),
          },
        );
      }
    });
    if (!target.fromEnv) await this.leaveManagedSchool(userId);
    await Promise.all([
      this.cache.delete(`profile:${userId}`),
      this.cache.deleteByPrefix(userPermCachePrefix(userId)),
    ]);
    this.logger.log(`Organisation admin ${actorId} removed ${userId}`);
    return { removed: true };
  }

  /**
   * A former organisation admin whose active school was one they only
   * managed (no membership) moves to one of their memberships, or to none.
   */
  private async leaveManagedSchool(userId: string) {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true },
    });
    if (!profile?.school_id) return;
    const memberships = await this.prisma.school_management.findMany({
      where: { user_id: userId },
      select: { school_id: true, role: true },
    });
    if (memberships.some((m) => m.school_id === profile.school_id)) return;
    const next = memberships[0];
    await this.prisma.user_profile.update({
      where: { id: userId },
      data: {
        school_id: next?.school_id ?? null,
        role: next?.role ?? null,
        updated_at: new Date(),
      },
    });
  }

  // --- schools -------------------------------------------------------------

  async schools(
    search?: string,
    status?: string,
  ): Promise<OrganisationSchoolRow[]> {
    const needle = search?.trim();
    const and: Prisma.schoolWhereInput[] = [];
    if (needle) {
      and.push({
        OR: [
          { name: textSearch.contains(needle) },
          { code: textSearch.contains(needle) },
        ],
      });
    }
    // is_active is nullable; null has always meant active.
    if (status === 'active')
      and.push({ OR: [{ is_active: true }, { is_active: null }] });
    else if (status === 'inactive') and.push({ is_active: false });
    const where: Prisma.schoolWhereInput = and.length ? { AND: and } : {};

    const schools = await this.prisma.school.findMany({
      where,
      select: SCHOOL_SELECT,
      orderBy: { name: 'asc' },
    });
    return this.schoolRows(schools);
  }

  /** One school's row (as in the list) plus its logo, for its console page. */
  async school(schoolId: string): Promise<OrganisationSchoolDetail> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { ...SCHOOL_SELECT, logo_path: true },
    });
    if (!school) throw new NotFoundException('School not found');
    const { logo_path, ...selected } = school;
    const [row] = await this.schoolRows([selected]);
    return { ...row, logoUrl: optionalImageUrl(logo_path) };
  }

  /**
   * Create a school with its system roles (admin, teacher, member).
   * The organisation admin does not become a member. With `adminEmail`, that
   * account becomes the school's admin, or is invited when it has none yet.
   */
  async createSchool(
    actorId: string,
    dto: CreateOrganisationSchoolDto,
  ): Promise<AppointedSchoolRow> {
    let school: { id: string };
    try {
      school = await this.prisma.$transaction(async (tx) => {
        const created = await tx.school.create({
          data: {
            name: dto.name.trim(),
            code: dto.code?.trim() || null,
            school_type: dto.schoolType ?? null,
            is_active: true,
          },
          select: {
            id: true,
            name: true,
            code: true,
            school_type: true,
            is_active: true,
          },
        });
        await seedSchoolSystemRoles(tx, created.id);
        await this.auditLog?.record(
          tx,
          created.id,
          { id: actorId },
          {
            entity: 'school',
            entityId: created.id,
            action: 'create',
            changes: auditChanges(null, {
              name: created.name,
              code: created.code,
              school_type: created.school_type,
              is_active: created.is_active,
            }),
          },
        );
        return created;
      });
    } catch (err) {
      this.logger.error(`Failed to create school: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create school');
    }
    await this.cache.delete('schools:all');
    this.logger.log(
      `Organisation admin ${actorId} created school ${school.id}`,
    );

    if (dto.adminEmail)
      return this.appointAdmin(actorId, school.id, dto.adminEmail);
    return { ...(await this.schoolRow(school.id)), invited: null };
  }

  async updateSchool(
    schoolId: string,
    dto: UpdateOrganisationSchoolDto,
    actorId?: string,
  ) {
    await this.requireSchool(schoolId);
    const data: Prisma.schoolUncheckedUpdateInput = { updated_at: new Date() };
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.code !== undefined) data.code = dto.code?.trim() || null;
    if (dto.schoolType !== undefined) data.school_type = dto.schoolType;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.school.findUniqueOrThrow({
          where: { id: schoolId },
          select: {
            name: true,
            code: true,
            school_type: true,
            is_active: true,
          },
        });
        const updated = await tx.school.update({
          where: { id: schoolId },
          data,
          select: {
            name: true,
            code: true,
            school_type: true,
            is_active: true,
          },
        });
        if (actorId) {
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: actorId },
            {
              entity: 'school',
              entityId: schoolId,
              action: 'update',
              changes: auditChanges(before, updated),
            },
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to update school ${schoolId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update school');
    }
    await this.cache.delete('schools:all');
    // Members' profiles embed the school.
    const members = await this.prisma.user_profile.findMany({
      where: { school_id: schoolId },
      select: { id: true },
    });
    await Promise.all(members.map((m) => this.cache.delete(`profile:${m.id}`)));
    return this.schoolRow(schoolId);
  }

  /**
   * Make an existing account the school's admin and owner (seatSchoolAdmin:
   * the previous admin becomes a teacher, the school's open admin invite is
   * revoked). With no account for the email, invite it instead: it becomes
   * the admin at its first verified sign-in, and the school's row shows the
   * pending invite meanwhile.
   */
  async appointAdmin(
    actorId: string,
    schoolId: string,
    email: string,
  ): Promise<AppointedSchoolRow> {
    await this.requireSchool(schoolId);
    const user = await this.findUserByEmail(email);
    if (!user) {
      const invited = await this.invites.invite(
        actorId,
        'school_admin',
        email,
        schoolId,
      );
      return { ...(await this.schoolRow(schoolId)), invited };
    }
    if (user.account_type === 'student') {
      throw new BadRequestException('A student account cannot run a school');
    }
    if (user.account_type === 'parent') {
      throw new BadRequestException('A parent account cannot run a school');
    }

    let previous: string | null;
    try {
      previous = await this.prisma.$transaction(async (tx) => {
        const [currentAdmin, targetMembership] = await Promise.all([
          tx.school_management.findFirst({
            where: { school_id: schoolId, role: 'admin' },
            select: { id: true, user_id: true },
          }),
          tx.school_management.findUnique({
            where: {
              user_id_school_id: { user_id: user.id, school_id: schoolId },
            },
            select: { id: true, role: true },
          }),
        ]);
        const demoted = await seatSchoolAdmin(tx, user, schoolId);
        const updatedMembership = await tx.school_management.findUnique({
          where: {
            user_id_school_id: { user_id: user.id, school_id: schoolId },
          },
          select: { id: true, role: true },
        });
        if (targetMembership?.id && updatedMembership) {
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: actorId },
            {
              entity: 'school_membership',
              entityId: updatedMembership.id,
              action: 'update',
              changes: auditChanges(
                { role: targetMembership.role },
                { role: updatedMembership.role },
              ),
            },
          );
        } else if (updatedMembership) {
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: actorId },
            {
              entity: 'school_membership',
              entityId: updatedMembership.id,
              action: 'create',
              changes: auditChanges(null, { role: updatedMembership.role }),
            },
          );
        }
        if (currentAdmin && demoted) {
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: actorId },
            {
              entity: 'school_membership',
              entityId: currentAdmin.id,
              action: 'update',
              changes: auditChanges({ role: 'admin' }, { role: 'teacher' }),
            },
          );
        }
        return demoted;
      });
    } catch (err) {
      this.logger.error(
        `Failed to appoint ${user.id} admin of ${schoolId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to appoint the school admin');
    }

    const affected = previous ? [user.id, previous] : [user.id];
    await Promise.all(
      affected.flatMap((id) => [
        this.cache.delete(`profile:${id}`),
        this.cache.delete(permCacheKey(id, schoolId)),
      ]),
    );
    this.logger.log(
      `Organisation admin ${actorId} appointed ${user.id} admin of ${schoolId}` +
        (previous ? ` (was ${previous}, now a teacher)` : ''),
    );
    return { ...(await this.schoolRow(schoolId)), invited: null };
  }

  // --- users ---------------------------------------------------------------

  /** Sign any user out of every device (a compromised account). */
  async revokeUserSessions(actorId: string, userId: string) {
    const user = await this.prisma.app_user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const revoked = await this.sessions.revokeAll(userId, 'organisation_admin');
    this.logger.log(
      `Organisation admin ${actorId} signed user ${userId} out of ${revoked} session(s)`,
    );
    return { revoked };
  }

  // --- helpers -------------------------------------------------------------

  /** 404 unless the school exists (org-admin routes for one school). */
  async requireSchool(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    });
    if (!school) throw new NotFoundException('School not found');
  }

  private async findUserByEmail(email: string) {
    const account = await this.prisma.app_user.findUnique({
      where: { email: normalizeEmail(email) },
      select: {
        user_profile: {
          select: { id: true, school_id: true, account_type: true },
        },
      },
    });
    // The profile shares the account's id.
    return account?.user_profile ?? null;
  }

  private async schoolRow(schoolId: string): Promise<OrganisationSchoolRow> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: SCHOOL_SELECT,
    });
    if (!school) throw new NotFoundException('School not found');
    return (await this.schoolRows([school]))[0];
  }

  private async schoolRows(
    schools: SchoolSelected[],
  ): Promise<OrganisationSchoolRow[]> {
    if (schools.length === 0) return [];
    const ids = schools.map((s) => s.id);
    const [admins, staff, students, invites] = await Promise.all([
      this.prisma.school_management.findMany({
        where: { school_id: { in: ids }, role: 'admin' },
        select: {
          school_id: true,
          user_id: true,
          user_profile: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
              app_user: { select: { email: true } },
            },
          },
        },
      }),
      this.prisma.school_management.groupBy({
        by: ['school_id'],
        where: { school_id: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.student.groupBy({
        by: ['school_id'],
        where: { school_id: { in: ids } },
        _count: { _all: true },
      }),
      this.invites.pendingForSchools(ids),
    ]);
    const adminBy = new Map(admins.map((a) => [a.school_id, a]));
    const staffBy = new Map(staff.map((g) => [g.school_id, g._count._all]));
    const studentsBy = new Map(
      students.map((g) => [g.school_id, g._count._all]),
    );

    return schools.map((s) => {
      const admin = adminBy.get(s.id);
      return {
        id: s.id,
        name: s.name ?? '',
        code: s.code,
        schoolType: s.school_type,
        isActive: s.is_active !== false,
        createdAt: s.created_at?.toISOString() ?? null,
        ownerId: s.owner_id ?? null,
        admin: admin
          ? {
              userId: admin.user_id,
              email:
                admin.user_profile.app_user?.email ??
                admin.user_profile.email ??
                '',
              name: displayName(admin.user_profile),
            }
          : null,
        staffCount: staffBy.get(s.id) ?? 0,
        studentCount: studentsBy.get(s.id) ?? 0,
        pendingAdminInvite: admin ? null : (invites.get(s.id) ?? null),
      };
    });
  }
}

const SCHOOL_SELECT = {
  id: true,
  name: true,
  code: true,
  school_type: true,
  is_active: true,
  created_at: true,
  owner_id: true,
} as const;

type SchoolSelected = Prisma.schoolGetPayload<{ select: typeof SCHOOL_SELECT }>;
