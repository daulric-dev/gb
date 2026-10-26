import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { SessionService } from '@/account/session.service';
import { plan } from '@/erasure/erasure-plan';
import { CreateSchoolDto } from './dto/create-school.dto';

const SCHOOL_TTL = 60 * 60 * 24 * 30;

type BaseRole = 'admin' | 'member' | 'teacher' | null;

@Injectable()
export class SchoolService {
  private readonly logger = new Logger(SchoolService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly erasure: ErasureLogService,
    private readonly sessions: SessionService,
  ) {}

  async findAll() {
    const cached = await this.cache.get('schools:all');
    if (cached) return cached;

    let data;
    try {
      data = await this.prisma.school.findMany({
        where: { is_active: true },
        select: { id: true, name: true, school_type: true },
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch schools: ${(err as Error).message}`);
      return [];
    }

    await this.cache.set('schools:all', data, SCHOOL_TTL);
    return data;
  }

  async create(dto: CreateSchoolDto, userId: string) {
    if (process.env.DEDICATED_DEPLOYMENT === 'true') {
      const count = await this.prisma.school.count().catch(() => 0);

      if (count > 0) {
        throw new ForbiddenException(
          'School creation is disabled on dedicated deployments',
        );
      }
    }

    let data;
    try {
      data = await this.prisma.school.create({
        data: {
          name: dto.name,
          code: dto.code ?? null,
          school_type: dto.schoolType,
          address: dto.address ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          is_active: true,
          owner_id: userId,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to create school: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create school');
    }

    // Canonical membership record - creator is admin
    try {
      await this.prisma.school_management.create({
        data: { user_id: userId, school_id: data.id, role: 'admin' },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create school_management row for ${userId} at ${data.id}: ${(err as Error).message}`,
      );
    }

    // Mirror to user_profile (denormalized cache for active school + role)
    try {
      await this.prisma.user_profile.updateMany({
        where: { id: userId },
        data: { school_id: data.id, role: 'admin' },
      });
    } catch (err) {
      this.logger.error(
        `Failed to assign creator ${userId} to school ${data.id}: ${(err as Error).message}`,
      );
    }

    await this.cache.delete(`profile:${userId}`);
    await this.cache.update<any[]>(
      'schools:all',
      (list) =>
        [...list, data].sort((a, b) =>
          (a.name ?? '').localeCompare(b.name ?? ''),
        ),
      SCHOOL_TTL,
    );
    return data;
  }

  async createJoinRequest(userId: string, schoolId: string, message?: string) {
    // Verify the school exists and is active
    const school = await this.prisma.school
      .findFirst({
        where: { id: schoolId, is_active: true },
        select: { id: true, name: true },
      })
      .catch(() => null);

    if (!school) {
      throw new NotFoundException('School not found');
    }

    const existing = await this.prisma.school_join_request
      .findFirst({
        where: { user_id: userId, status: 'pending' },
        select: { id: true, school_id: true },
      })
      .catch(() => null);

    if (existing) {
      throw new BadRequestException(
        'You already have a pending join request. Please wait for it to be reviewed.',
      );
    }

    let data;
    try {
      data = await this.prisma.school_join_request.create({
        data: {
          user_id: userId,
          school_id: schoolId,
          message: message ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create join request for user ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to submit join request');
    }

    return { ...data, school };
  }

  async getPendingRequests(adminUserId: string) {
    const schoolId = await this.adminSchoolId(adminUserId);

    try {
      const rows = await this.prisma.school_join_request.findMany({
        where: { school_id: schoolId, status: 'pending' },
        select: {
          id: true,
          status: true,
          message: true,
          requested_at: true,
          user_profile_school_join_request_user_idTouser_profile: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              account_type: true,
            },
          },
          school: { select: { id: true, name: true } },
        },
        orderBy: { requested_at: 'asc' },
      });

      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        requested_at: r.requested_at,
        user: r.user_profile_school_join_request_user_idTouser_profile,
        school: r.school,
      }));
    } catch (err) {
      this.logger.error(
        `Failed to fetch join requests: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to fetch join requests');
    }
  }

  async approveRequest(
    adminUserId: string,
    requestId: string,
    role: BaseRole,
    customRoleIds: string[] = [],
  ) {
    const adminSchoolId = await this.adminSchoolId(adminUserId);

    const request = await this.prisma.school_join_request
      .findUnique({
        where: { id: requestId },
        select: { id: true, user_id: true, school_id: true, status: true },
      })
      .catch(() => null);

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    // Students do not arrive this way: they join with the school's code, which
    // creates their record directly. Join requests are staff only.
    const requester = await this.prisma.user_profile
      .findUnique({
        where: { id: request.user_id },
        select: { account_type: true },
      })
      .catch(() => null);

    if (requester?.account_type === 'student') {
      throw new BadRequestException(
        'Students join with the school join code, not a join request',
      );
    }

    if (request.school_id !== adminSchoolId) {
      throw new ForbiddenException(
        'This request does not belong to your school',
      );
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    const uniqueRoleIds = [...new Set(customRoleIds)];
    if (uniqueRoleIds.length > 0) {
      const customRoles = await this.prisma.school_role
        .findMany({
          where: { id: { in: uniqueRoleIds } },
          select: { id: true, school_id: true, is_system: true },
        })
        .catch(() => null);
      if (
        !customRoles ||
        customRoles.length !== uniqueRoleIds.length ||
        customRoles.some(
          (customRole) =>
            customRole.school_id !== request.school_id || customRole.is_system,
        )
      ) {
        throw new BadRequestException('Invalid custom role selection');
      }
    }

    // Membership, custom roles, profile mirror and the request's status
    // change together: a failure part-way leaves nothing behind.
    const updated = await this.prisma.$transaction(async (tx) => {
      // Canonical membership record (upsert in case a prior membership
      // exists for this pair).
      let membership: { id: string };
      try {
        membership = await tx.school_management.upsert({
          where: {
            user_id_school_id: {
              user_id: request.user_id,
              school_id: request.school_id,
            },
          },
          create: {
            user_id: request.user_id,
            school_id: request.school_id,
            role,
            updated_at: new Date(),
          },
          update: { role, updated_at: new Date() },
          select: { id: true },
        });
      } catch (err) {
        this.logger.error(
          `Failed to upsert school_management for ${request.user_id}: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to approve request');
      }

      if (uniqueRoleIds.length > 0) {
        try {
          await tx.school_management_role.createMany({
            data: uniqueRoleIds.map((school_role_id) => ({
              school_management_id: membership.id,
              school_role_id,
            })),
          });
        } catch {
          throw new BadRequestException('Failed to assign custom roles');
        }
      }

      // Mirror to user_profile (denormalized cache)
      try {
        await tx.user_profile.updateMany({
          where: { id: request.user_id },
          data: { school_id: request.school_id, role, is_active: true },
        });
      } catch (err) {
        this.logger.error(
          `Failed to update profile for user ${request.user_id}: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to approve request');
      }

      try {
        return await tx.school_join_request.update({
          where: { id: requestId },
          data: {
            status: 'approved',
            reviewed_by: adminUserId,
            reviewed_at: new Date(),
          },
        });
      } catch (err) {
        this.logger.error(
          `Failed to update join request ${requestId}: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to approve request');
      }
    });

    await this.cache.delete(`profile:${request.user_id}`);
    return updated;
  }

  async getMyPendingRequest(userId: string) {
    return this.prisma.school_join_request
      .findFirst({
        where: { user_id: userId, status: 'pending' },
        select: {
          id: true,
          school_id: true,
          status: true,
          requested_at: true,
        },
      })
      .catch(() => null);
  }

  async getMembers(userId: string) {
    const schoolId = await this.ownSchoolId(userId);

    let data;
    try {
      data = await this.prisma.school_management.findMany({
        where: { school_id: schoolId },
        select: {
          id: true,
          role: true,
          created_at: true,
          school: { select: { owner_id: true } },
          user_profile: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              avatar_url: true,
            },
          },
          school_management_role: {
            select: {
              school_role: {
                select: { id: true, name: true, is_system: true },
              },
            },
          },
        },
        orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
      });
    } catch (err) {
      this.logger.error(
        `Failed to fetch school members: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to fetch school members');
    }

    return data.map((member) => {
      // Only the custom (non-system) roles are worth surfacing — the base
      // enum role is already conveyed by the section the member sits under.
      const roles = member.school_management_role
        .map((link) => link.school_role)
        .filter((r) => Boolean(r) && !r.is_system)
        .map((r) => ({ id: r.id, name: r.name }));
      return {
        id: member.id,
        role: member.role,
        created_at: member.created_at,
        school: member.school,
        user: member.user_profile,
        is_owner: member.school?.owner_id === member.user_profile?.id,
        roles,
      };
    });
  }

  async leaveSchool(userId: string) {
    const profile = await this.prisma.user_profile
      .findUnique({
        where: { id: userId },
        select: { school_id: true, role: true },
      })
      .catch(() => null);

    if (!profile?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }
    const schoolId = profile.school_id;

    const school = await this.prisma.school
      .findUnique({ where: { id: schoolId }, select: { owner_id: true } })
      .catch(() => null);
    if (school?.owner_id === userId) {
      throw new ForbiddenException('The school owner cannot leave the school');
    }

    if (profile.role === 'admin') {
      const count = await this.prisma.school_management
        .count({ where: { school_id: schoolId, role: 'admin' } })
        .catch(() => 0);

      if (count <= 1) {
        throw new BadRequestException(
          'You are the only admin. Assign another admin before leaving.',
        );
      }
    }

    // As before, each clean-up step is best effort; removing the membership
    // and its erasure-log entry commit together.
    const steps: [string, () => Promise<unknown>][] = [
      [
        'remove membership',
        () =>
          this.prisma.$transaction(async (tx) => {
            const gone = await tx.school_management.findMany({
              where: { user_id: userId, school_id: schoolId },
              select: { id: true },
            });
            if (gone.length === 0) return;
            await tx.school_management.deleteMany({
              where: { id: { in: gone.map((m) => m.id) } },
            });
            await this.erasure.record(tx, {
              kind: 'school_membership',
              subjectTable: 'public.school_management',
              subjectIds: gone.map((m) => m.id),
              schoolId,
              actor: userId,
              reason: 'user_request',
              replay: this.membershipReplay(
                gone.map((m) => m.id),
                userId,
                schoolId,
              ),
            });
          }),
      ],
      [
        'withdraw pending requests',
        () =>
          this.prisma.school_join_request.deleteMany({
            where: { user_id: userId, status: 'pending' },
          }),
      ],
      [
        'detach profile',
        () =>
          this.prisma.user_profile.updateMany({
            where: { id: userId },
            data: { school_id: null, role: null },
          }),
      ],
    ];
    for (const [label, run] of steps) {
      try {
        await run();
      } catch (err) {
        this.logger.error(
          `Leave school: failed to ${label} for ${userId}: ${(err as Error).message}`,
        );
      }
    }

    await this.cache.delete(`profile:${userId}`);
    return { left: true };
  }

  async removeMember(adminUserId: string, membershipId: string) {
    const adminSchoolId = await this.adminSchoolId(adminUserId);

    const membership = await this.prisma.school_management
      .findUnique({
        where: { id: membershipId },
        select: { id: true, user_id: true, school_id: true, role: true },
      })
      .catch(() => null);

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    if (membership.school_id !== adminSchoolId) {
      throw new ForbiddenException(
        'This membership does not belong to your school',
      );
    }

    const school = await this.prisma.school
      .findUnique({ where: { id: adminSchoolId }, select: { owner_id: true } })
      .catch(() => null);
    if (school?.owner_id === membership.user_id) {
      throw new ForbiddenException('The school owner cannot be removed');
    }

    if (membership.user_id === adminUserId) {
      throw new BadRequestException('You cannot remove yourself');
    }

    // The membership, detaching the user (only if this was their active
    // school) and the erasure-log entry commit together.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.school_management.deleteMany({
          where: { id: membershipId },
        });
        await tx.user_profile.updateMany({
          where: { id: membership.user_id, school_id: membership.school_id },
          data: { school_id: null, role: null },
        });
        await this.erasure.record(tx, {
          kind: 'school_membership',
          subjectTable: 'public.school_management',
          subjectIds: [membershipId],
          schoolId: membership.school_id,
          actor: adminUserId,
          reason: 'admin',
          replay: this.membershipReplay(
            [membershipId],
            membership.user_id,
            membership.school_id,
          ),
        });
      });
    } catch (err) {
      this.logger.error(
        `Failed to remove member ${membershipId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to remove member');
    }

    await this.cache.delete(`profile:${membership.user_id}`);
    return { removed: true };
  }

  /** Replaying a removal: drop the membership, detach the user from that school. */
  private membershipReplay(
    membershipIds: string[],
    userId: string,
    schoolId: string,
  ) {
    return plan.of(
      plan.del('public.school_management', { id: membershipIds }),
      plan.update(
        'public.user_profile',
        { id: [userId], school_id: [schoolId] },
        { school_id: null, role: null },
      ),
    );
  }

  async rejectRequest(adminUserId: string, requestId: string) {
    const adminSchoolId = await this.adminSchoolId(adminUserId);

    const request = await this.prisma.school_join_request
      .findUnique({
        where: { id: requestId },
        select: { id: true, school_id: true, status: true },
      })
      .catch(() => null);

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    if (request.school_id !== adminSchoolId) {
      throw new ForbiddenException(
        'This request does not belong to your school',
      );
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    try {
      return await this.prisma.school_join_request.update({
        where: { id: requestId },
        data: {
          status: 'rejected',
          reviewed_by: adminUserId,
          reviewed_at: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to reject join request ${requestId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to reject request');
    }
  }

  // --- helpers -------------------------------------------------------------

  /**
   * Sign a staff member of the admin's school out of every device (a lost
   * laptop, a member leaving). Revocation is immediate. Memberships of other
   * schools are a 404; only the owner can sign the owner out.
   */
  async revokeMemberSessions(adminUserId: string, membershipId: string) {
    const adminSchoolId = await this.adminSchoolId(adminUserId);
    const membership = await this.prisma.school_management
      .findUnique({
        where: { id: membershipId },
        select: { user_id: true, school_id: true, school: { select: { owner_id: true } } },
      })
      .catch(() => null);
    if (!membership || membership.school_id !== adminSchoolId) {
      throw new NotFoundException('Membership not found');
    }
    if (
      membership.school?.owner_id === membership.user_id &&
      membership.user_id !== adminUserId
    ) {
      throw new ForbiddenException('Only the school owner can sign the owner out');
    }

    const revoked = await this.sessions.revokeAll(membership.user_id, 'admin');
    this.logger.log(
      `Admin ${adminUserId} signed member ${membership.user_id} out of ${revoked} session(s) in school ${adminSchoolId}`,
    );
    return { revoked };
  }

  private async activeSchoolId(userId: string): Promise<string | null> {
    const profile = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { school_id: true } })
      .catch(() => null);
    return profile?.school_id ?? null;
  }

  private async adminSchoolId(adminUserId: string): Promise<string> {
    const schoolId = await this.activeSchoolId(adminUserId);
    if (!schoolId) {
      throw new BadRequestException('Admin is not assigned to a school');
    }
    return schoolId;
  }

  private async ownSchoolId(userId: string): Promise<string> {
    const schoolId = await this.activeSchoolId(userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return schoolId;
  }
}
