import type { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { defaultsForRole, PermissionKey } from './permission.catalog';

/** Effective-permission payload for one (user, school) pair. */
export interface EffectivePermissions {
  member: boolean;
  /** The user's enum role in the school (null when not a member). */
  role: string | null;
  keys: string[];
}

/** How long an effective-permission set is cached. Bounds staleness after an
 *  admin edits a role; writes also actively invalidate (see PermissionService). */
export const PERM_TTL = 45;

export const PERM_CACHE_PREFIX = 'perm:eff:';

export const permCacheKey = (userId: string, schoolId: string) =>
  `${PERM_CACHE_PREFIX}${userId}:${schoolId}`;

/**
 * Compute a user's effective permissions in a school:
 * `ROLE_DEFAULTS[enum role] ∪ permissions of any assigned custom role`, with
 * admins granted the full catalog. Shared by PermissionGuard (capability gate)
 * and the `/permissions/me` endpoint, so both agree on what a user can do.
 */
export async function computeEffectivePermissions(
  prisma: PrismaService,
  userId: string,
  schoolId: string,
): Promise<EffectivePermissions> {
  const membership = await prisma.school_management.findFirst({
    where: { user_id: userId, school_id: schoolId },
    select: {
      role: true,
      // Custom roles assigned to this membership, with their grants.
      school_management_role: {
        select: {
          school_role: {
            select: {
              school_role_permission: {
                select: { permission_catalog: { select: { key: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!membership) {
    return { member: false, role: null, keys: [] };
  }

  // Admin: full catalog, scoped to this school.
  if (membership.role === 'admin') {
    return {
      member: true,
      role: 'admin',
      keys: [...defaultsForRole('admin')],
    };
  }

  const keys = defaultsForRole(membership.role as string);

  // Union any custom roles assigned to this membership.
  for (const assigned of membership.school_management_role) {
    for (const grant of assigned.school_role.school_role_permission) {
      keys.add(grant.permission_catalog.key as PermissionKey);
    }
  }

  return { member: true, role: membership.role, keys: [...keys] };
}

export async function loadEffectivePermissions(
  prisma: PrismaService,
  cache: CacheService,
  userId: string,
  schoolId: string,
): Promise<EffectivePermissions> {
  const key = permCacheKey(userId, schoolId);
  const cached = (await cache.get(key)) as EffectivePermissions | null;
  if (cached) return cached;

  const effective = await computeEffectivePermissions(
    prisma,
    userId,
    schoolId,
  );
  await cache.set(key, effective, PERM_TTL);
  return effective;
}
