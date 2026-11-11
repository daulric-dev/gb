import type { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { defaultsForRole, PermissionKey } from './permission.catalog';
import { isOrgAdmin } from '@/organisation/org-admin';

/** Effective-permission payload for one (user, school) pair. */
export interface EffectivePermissions {
  /** May act in the school: a member, or an organisation admin. */
  member: boolean;
  /** The user's enum role in the school (null when not a member). An
   *  organisation admin reads as 'admin' in every school. */
  role: string | null;
  keys: string[];
  /** True when the access comes from being an organisation admin rather
   *  than (only) a membership: they administer every school in the install. */
  viaOrganisation?: boolean;
}

/** How long an effective-permission set is cached. Bounds staleness after an
 *  admin edits a role; writes also actively invalidate (see PermissionService). */
export const PERM_TTL = 45;

export const PERM_CACHE_PREFIX = 'perm:eff:';

export const permCacheKey = (userId: string, schoolId: string) =>
  `${PERM_CACHE_PREFIX}${userId}:${schoolId}`;

/** Prefix of every cached set for one user (all schools). */
export const userPermCachePrefix = (userId: string) =>
  `${PERM_CACHE_PREFIX}${userId}:`;

/**
 * Compute a user's effective permissions in a school:
 * `ROLE_DEFAULTS[enum role] ∪ permissions of any assigned custom role`, with
 * admins granted the catalog except EXPLICIT_ONLY_KEYS (safeguarding), which
 * only an assigned role can add. Organisation admins (public.organisation_admin
 * or ORG_ADMIN_EMAILS) are administrators of every school: they get the same
 * admin defaults with or without a membership row. This is the one place that rule
 * lives. Shared by PermissionGuard (capability gate)
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

  // Grants from custom roles assigned to this membership. Added for every
  // base role, admins included: keys outside the admin defaults (such as
  // pastoral-note:safeguarding) are only ever held this way.
  const granted = (keys: Set<PermissionKey>) => {
    for (const assigned of membership?.school_management_role ?? []) {
      for (const grant of assigned.school_role.school_role_permission) {
        keys.add(grant.permission_catalog.key as PermissionKey);
      }
    }
    return [...keys];
  };

  // Admin: the catalog except EXPLICIT_ONLY_KEYS, scoped to this school.
  if (membership?.role === 'admin') {
    return {
      member: true,
      role: 'admin',
      keys: granted(defaultsForRole('admin')),
    };
  }

  // An organisation admin administers every school in the install, with the
  // same defaults as a school admin: never safeguarding through the
  // organisation. A membership in this school can add it through a role.
  if (await isOrgAdmin(prisma, userId).catch(() => false)) {
    return {
      member: true,
      role: 'admin',
      keys: granted(defaultsForRole('admin')),
      viaOrganisation: true,
    };
  }

  if (!membership) {
    return { member: false, role: null, keys: [] };
  }

  return {
    member: true,
    role: membership.role,
    keys: granted(defaultsForRole(membership.role as string)),
  };
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
