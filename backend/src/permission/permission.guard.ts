import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { PERMISSION_KEY } from './require-permission.decorator';
import { defaultsForRole, PermissionKey } from './permission.catalog';

/** Cached effective-permission payload for one (user, school) pair. */
interface EffectivePermissions {
  member: boolean;
  keys: string[];
}

/** How long an effective-permission set is cached. Bounds staleness after an
 *  admin edits a role; writes also actively invalidate (see PermissionService). */
const PERM_TTL = 45;

export const PERM_CACHE_PREFIX = 'perm:eff:';

const cacheKey = (userId: string, schoolId: string) =>
  `${PERM_CACHE_PREFIX}${userId}:${schoolId}`;

/**
 * Capability gate: checks that the user's role (enum defaults ∪ assigned custom
 * roles) grants the catalog permission declared by @RequirePermission, scoped
 * to the school that owns the targeted resource.
 *
 * Inert on routes without @RequirePermission. Must run after AuthGuard (needs
 * request.user). Composes with instance-ownership guards like ClassTeacherGuard
 * — both must pass.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Unannotated route: this guard does not apply.
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      // AuthGuard should have populated request.user; if not, fail closed.
      throw new ForbiddenException('Authentication required');
    }

    const schoolId = await this.resolveSchoolContext(request);
    if (!schoolId) {
      throw new ForbiddenException('Could not resolve school context');
    }

    const effective = await this.loadEffectivePermissions(userId, schoolId);

    if (!effective.member) {
      this.logger.warn(
        `User ${userId} is not a member of school ${schoolId} (needs ${required})`,
      );
      throw new ForbiddenException('You are not a member of this school');
    }

    if (effective.keys.includes(required)) {
      return true;
    }

    this.logger.warn(
      `User ${userId} denied: missing permission ${required} in school ${schoolId}`,
    );
    throw new ForbiddenException(`Missing permission: ${required}`);
  }

  /**
   * Resolve the school that owns the targeted resource: explicit :schoolId,
   * else via the class/report the route addresses, else the user's active
   * school. We never silently pick one of several memberships for an
   * anchorless route — the active-school fallback uses the denormalized
   * user_profile.school_id, which is the user's single current school.
   */
  private async resolveSchoolContext(
    request: any,
  ): Promise<string | undefined> {
    if (request.params?.schoolId) return request.params.schoolId;

    const supabase = this.supabaseService.getServiceClient();

    const classId =
      request.params?.classId ??
      request.body?.studentGroupId ??
      request.query?.studentGroupId ??
      undefined;

    if (classId) {
      const { data: studentGroup } = await supabase
        .from('student_group')
        .select('academic_year:academic_year_id(school_id)')
        .eq('id', classId)
        .maybeSingle();

      const classSchoolId = (
        studentGroup?.academic_year as { school_id?: string } | null
      )?.school_id;
      if (classSchoolId) return classSchoolId;
    }

    // Fallback: the user's active school (denormalized single current school).
    const { data: profile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', request.user.id)
      .maybeSingle();

    return profile?.school_id ?? undefined;
  }

  private async loadEffectivePermissions(
    userId: string,
    schoolId: string,
  ): Promise<EffectivePermissions> {
    const key = cacheKey(userId, schoolId);
    const cached = (await this.cache.get(key)) as EffectivePermissions | null;
    if (cached) return cached;

    const effective = await this.computeEffectivePermissions(userId, schoolId);
    await this.cache.set(key, effective, PERM_TTL);
    return effective;
  }

  private async computeEffectivePermissions(
    userId: string,
    schoolId: string,
  ): Promise<EffectivePermissions> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: membership } = await supabase
      .from('school_management')
      .select('id, role')
      .eq('user_id', userId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!membership) {
      return { member: false, keys: [] };
    }

    // Admin: full catalog, scoped to this resolved school.
    if (membership.role === 'admin') {
      return { member: true, keys: [...defaultsForRole('admin')] };
    }

    const keys = defaultsForRole(membership.role);

    // Union any custom roles assigned to this membership.
    const { data: assignedRoles } = await supabase
      .from('school_management_role')
      .select('school_role_id')
      .eq('school_management_id', membership.id);

    const roleIds = (assignedRoles ?? []).map(
      (r: { school_role_id: string }) => r.school_role_id,
    );

    if (roleIds.length > 0) {
      const { data: grants } = await supabase
        .from('school_role_permission')
        .select('permission_catalog:permission_id(key)')
        .in('school_role_id', roleIds);

      for (const g of grants ?? []) {
        const grantKey = (g.permission_catalog as { key?: string } | null)?.key;
        if (grantKey) keys.add(grantKey as PermissionKey);
      }
    }

    return { member: true, keys: [...keys] };
  }
}
