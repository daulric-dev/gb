import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '@/cache/cache.service';
import {
  loadEffectivePermissions,
  PERM_CACHE_PREFIX,
} from './permission.effective';
import {
  defaultsForRole,
  isPermissionKey,
  PERMISSION_CATALOG,
} from './permission.catalog';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { isUniqueViolation, pgCode } from '@/common/db-values';

/** The role columns every role endpoint returns. */
const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  is_system: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  /** The code-defined catalog of assignable permissions (for the admin UI). */
  listCatalog() {
    return PERMISSION_CATALOG.map(({ resource, action, key, description }) => ({
      resource,
      action,
      key,
      description,
    }));
  }

  async listRoles(adminUserId: string) {
    const schoolId = await this.requireAdminSchool(adminUserId);

    try {
      return await this.prisma.school_role.findMany({
        where: { school_id: schoolId },
        select: ROLE_SELECT,
        orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
      });
    } catch (err) {
      this.logger.error(`Failed to list roles: ${(err as Error).message}`);
      throw new BadRequestException('Failed to list roles');
    }
  }

  async createRole(adminUserId: string, dto: CreateRoleDto) {
    const schoolId = await this.requireAdminSchool(adminUserId);

    try {
      return await this.prisma.school_role.create({
        data: {
          school_id: schoolId,
          name: dto.name,
          description: dto.description ?? null,
          is_system: false,
        },
        select: ROLE_SELECT,
      });
    } catch (err) {
      // Unique violation: name already used in this school.
      if (isUniqueViolation(err)) {
        throw new BadRequestException(
          'A role with this name already exists in your school',
        );
      }
      this.logger.error(`Failed to create role: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create role');
    }
  }

  async updateRole(adminUserId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.requireEditableRole(adminUserId, roleId);

    const patch: Prisma.school_roleUpdateInput = { updated_at: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;

    let data;
    try {
      data = await this.prisma.school_role.update({
        where: { id: role.id },
        data: patch,
        select: ROLE_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException(
          'A role with this name already exists in your school',
        );
      }
      this.logger.error(
        `Failed to update role ${roleId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update role');
    }

    await this.invalidate();
    return data;
  }

  async deleteRole(adminUserId: string, roleId: string) {
    const role = await this.requireEditableRole(adminUserId, roleId);

    try {
      await this.prisma.school_role.deleteMany({ where: { id: role.id } });
    } catch (err) {
      this.logger.error(
        `Failed to delete role ${roleId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete role');
    }

    await this.invalidate();
    return { deleted: true };
  }

  async getRolePermissions(adminUserId: string, roleId: string) {
    const role = await this.requireRoleInSchool(adminUserId, roleId);

    if (role.is_system) {
      return [...defaultsForRole(role.name)];
    }

    try {
      const grants = await this.prisma.school_role_permission.findMany({
        where: { school_role_id: roleId },
        select: { permission_catalog: { select: { key: true } } },
      });
      return grants
        .map((r) => r.permission_catalog?.key)
        .filter((k): k is string => Boolean(k));
    } catch (err) {
      this.logger.error(
        `Failed to read role permissions ${roleId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to read role permissions');
    }
  }

  /** Replace a role's entire permission set with the given catalog keys. */
  async setRolePermissions(
    adminUserId: string,
    roleId: string,
    keys: string[],
  ) {
    const role = await this.requireEditableRole(adminUserId, roleId);

    const invalid = keys.filter((k) => !isPermissionKey(k));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Unknown permission key(s): ${invalid.join(', ')}`,
      );
    }

    const uniqueKeys = [...new Set(keys)];

    try {
      // Map keys -> catalog ids.
      const catalog =
        uniqueKeys.length > 0
          ? await this.prisma.permission_catalog.findMany({
              where: { key: { in: uniqueKeys } },
              select: { id: true },
            })
          : [];
      const permissionIds = catalog.map((c) => c.id);

      // Replace: clear existing, then insert the new set, atomically.
      await this.prisma.$transaction(async (tx) => {
        await tx.school_role_permission.deleteMany({
          where: { school_role_id: role.id },
        });
        if (permissionIds.length > 0) {
          await tx.school_role_permission.createMany({
            data: permissionIds.map((permission_id) => ({
              school_role_id: role.id,
              permission_id,
            })),
          });
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to set role permissions ${roleId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to set role permissions');
    }

    await this.invalidate();
    return { keys: uniqueKeys };
  }

  async assignRoleToMember(
    adminUserId: string,
    membershipId: string,
    roleId: string,
  ) {
    const schoolId = await this.requireAdminSchool(adminUserId);
    await this.requireMembershipInSchool(membershipId, schoolId);
    await this.requireRoleInSchool(adminUserId, roleId);

    try {
      await this.prisma.school_management_role.upsert({
        where: {
          school_management_id_school_role_id: {
            school_management_id: membershipId,
            school_role_id: roleId,
          },
        },
        create: { school_management_id: membershipId, school_role_id: roleId },
        update: {},
      });
    } catch (err) {
      this.logger.error(`Failed to assign role: ${(err as Error).message}`);
      throw new BadRequestException('Failed to assign role');
    }

    await this.invalidate();
    return { assigned: true };
  }

  async changeMemberRole(
    adminUserId: string,
    membershipId: string,
    role: 'admin' | 'member' | 'teacher' | null,
  ) {
    const schoolId = await this.requireAdminSchool(adminUserId);
    const membership = await this.requireMembershipInSchool(
      membershipId,
      schoolId,
    );
    const school = await this.prisma.school
      .findUnique({ where: { id: schoolId }, select: { owner_id: true } })
      .catch(() => null);
    if (school?.owner_id === membership.user_id) {
      throw new ForbiddenException('The school owner role cannot be changed');
    }

    try {
      await this.prisma.school_management.update({
        where: { id: membershipId },
        data: { role, updated_at: new Date() },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `Failed to change member role ${membershipId}: ${message}`,
      );
      const notNull =
        pgCode(err) === '23502' ||
        (err as { code?: string } | null)?.code === 'P2011';
      throw new BadRequestException(
        role === null && notNull
          ? 'The database must allow members without a default role. Apply the nullable membership role migration first.'
          : `Failed to change member role: ${message}`,
      );
    }

    // user_profile.role is the role in the user's *active* school, and
    // AdminGuard / is_admin() trust it. Only mirror when this membership is
    // that school, or an admin of any school could grant admin elsewhere.
    try {
      await this.prisma.user_profile.updateMany({
        where: { id: membership.user_id, school_id: schoolId },
        data: { role },
      });
    } catch (err) {
      this.logger.error(
        `Failed to mirror member role ${membership.user_id}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to synchronize member role');
    }
    await this.cache.delete(`profile:${membership.user_id}`);
    await this.invalidate();
    return { role };
  }

  async unassignRoleFromMember(
    adminUserId: string,
    membershipId: string,
    roleId: string,
  ) {
    const schoolId = await this.requireAdminSchool(adminUserId);
    await this.requireMembershipInSchool(membershipId, schoolId);

    try {
      await this.prisma.school_management_role.deleteMany({
        where: { school_management_id: membershipId, school_role_id: roleId },
      });
    } catch (err) {
      this.logger.error(`Failed to unassign role: ${(err as Error).message}`);
      throw new BadRequestException('Failed to unassign role');
    }

    await this.invalidate();
    return { unassigned: true };
  }

  /** Custom roles currently assigned to a membership (for the admin UI). */
  async getMemberRoles(adminUserId: string, membershipId: string) {
    const schoolId = await this.requireAdminSchool(adminUserId);
    await this.requireMembershipInSchool(membershipId, schoolId);

    try {
      const rows = await this.prisma.school_management_role.findMany({
        where: { school_management_id: membershipId },
        select: {
          school_role: { select: { id: true, name: true, is_system: true } },
        },
      });
      return rows.map((r) => r.school_role).filter(Boolean);
    } catch (err) {
      this.logger.error(
        `Failed to read member roles: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to read member roles');
    }
  }

  /**
   * The caller's own effective permissions in their active school. Available to
   * any authenticated user (not admin-only) so the frontend can gate its UI.
   */
  async getMyPermissions(userId: string) {
    const profile = await this.prisma.user_profile
      .findUnique({
        where: { id: userId },
        select: { school_id: true, account_type: true },
      })
      .catch(() => null);

    const accountType = profile?.account_type ?? 'staff';
    const schoolId: string | null = profile?.school_id ?? null;

    if (!schoolId) {
      return {
        schoolId: null,
        role: null,
        accountType,
        isAdmin: false,
        permissions: [],
      };
    }

    // Students hold no catalog permissions by design: they have no
    // school_management row, so computing an effective set would query for a
    // membership that is never there. Their access comes from StudentGuard and
    // the /portal surface instead.
    if (accountType === 'student') {
      return {
        schoolId,
        role: null,
        accountType,
        isAdmin: false,
        permissions: [],
      };
    }

    const effective = await loadEffectivePermissions(
      this.prisma,
      this.cache,
      userId,
      schoolId,
    );

    return {
      schoolId,
      role: effective.role,
      accountType,
      isAdmin: effective.role === 'admin',
      permissions: effective.keys,
    };
  }

  // --- helpers -------------------------------------------------------------

  private async requireAdminSchool(adminUserId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, adminUserId).catch(
      () => null,
    );
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return schoolId;
  }

  /** Verify the role exists and belongs to the admin's school. */
  private async requireRoleInSchool(adminUserId: string, roleId: string) {
    const schoolId = await this.requireAdminSchool(adminUserId);

    // A malformed id matches no role, as before.
    const role = await this.prisma.school_role
      .findUnique({
        where: { id: roleId },
        select: { id: true, school_id: true, is_system: true, name: true },
      })
      .catch(() => null);

    if (!role) throw new NotFoundException('Role not found');
    if (role.school_id !== schoolId) {
      throw new ForbiddenException('This role does not belong to your school');
    }
    return role;
  }

  /** Same as requireRoleInSchool, but also rejects system roles (not editable). */
  private async requireEditableRole(adminUserId: string, roleId: string) {
    const role = await this.requireRoleInSchool(adminUserId, roleId);
    if (role.is_system) {
      throw new ForbiddenException('System roles cannot be modified');
    }
    return role;
  }

  private async requireMembershipInSchool(
    membershipId: string,
    schoolId: string,
  ) {
    const membership = await this.prisma.school_management
      .findUnique({
        where: { id: membershipId },
        select: { id: true, user_id: true, school_id: true },
      })
      .catch(() => null);

    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.school_id !== schoolId) {
      throw new ForbiddenException(
        'This membership does not belong to your school',
      );
    }
    return membership;
  }

  /** Flush cached effective-permission sets after a role/permission change. */
  private async invalidate() {
    await this.cache.deleteByPrefix(PERM_CACHE_PREFIX);
  }
}
