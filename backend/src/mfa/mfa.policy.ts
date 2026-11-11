import type { PrismaService } from '@/prisma/prisma.service';
import { defaultsForRole } from '@/permission/permission.catalog';
import { isOrgAdmin } from '@/organisation/org-admin';

export const SAFEGUARDING_KEY = 'pastoral-note:safeguarding';

/** The organisation setting "require an authenticator app for admins and safeguarding roles". */
export async function mfaRequiredForAdmins(prisma: PrismaService): Promise<boolean> {
  const org = await prisma.organisation.findFirst({ select: { require_mfa_for_admins: true } });
  return org?.require_mfa_for_admins === true;
}

/**
 * Whether the user's role is one the setting covers: an organisation admin,
 * a school admin, or a member whose built-in or custom role grants
 * `pastoral-note:safeguarding` in any school. A failed lookup throws; callers
 * decide whether that blocks.
 */
export async function holdsPrivilegedRole(prisma: PrismaService, userId: string): Promise<boolean> {
  if (await isOrgAdmin(prisma, userId)) return true;
  const memberships = await prisma.school_management.findMany({
    where: { user_id: userId },
    select: {
      role: true,
      school_management_role: {
        select: {
          school_role: {
            select: {
              school_role_permission: {
                where: { permission_catalog: { key: SAFEGUARDING_KEY } },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  return memberships.some(
    (m) =>
      m.role === 'admin' ||
      (m.role && defaultsForRole(m.role).has(SAFEGUARDING_KEY)) ||
      m.school_management_role.some((r) => r.school_role.school_role_permission.length > 0),
  );
}

/** The setting is on and covers this user. */
export async function mfaRequiredFor(prisma: PrismaService, userId: string): Promise<boolean> {
  if (!(await mfaRequiredForAdmins(prisma))) return false;
  return holdsPrivilegedRole(prisma, userId);
}
