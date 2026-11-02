import type { PrismaService } from '@/prisma/prisma.service';
import { normalizeEmail } from '@/account/email-code.service';

/**
 * ORG_ADMIN_EMAILS (comma separated), normalised. A signed-in account with a
 * verified email on the list is an organisation admin without a row in
 * public.organisation_admin; while the list is set, only those accounts may
 * run the first-run setup.
 */
export function orgAdminEmails(): Set<string> {
  return new Set(
    (process.env.ORG_ADMIN_EMAILS ?? '')
      .split(',')
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

/** A live account whose verified email is listed in ORG_ADMIN_EMAILS. */
export async function isEnvOrgAdmin(
  prisma: PrismaService,
  userId: string,
): Promise<boolean> {
  const emails = orgAdminEmails();
  if (emails.size === 0) return false;
  const user = await prisma.app_user.findUnique({
    where: { id: userId },
    select: { email: true, email_verified_at: true, disabled_at: true },
  });
  return (
    !!user &&
    !!user.email_verified_at &&
    !user.disabled_at &&
    emails.has(normalizeEmail(user.email))
  );
}

/**
 * An organisation admin: a row in public.organisation_admin, or a verified
 * account email in ORG_ADMIN_EMAILS. Shared by OrganisationAdminGuard and
 * the profile (`is_org_admin`), so both agree.
 */
export async function isOrgAdmin(
  prisma: PrismaService,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const row = await prisma.organisation_admin.findUnique({
    where: { user_id: userId },
    select: { user_id: true },
  });
  if (row) return true;
  return isEnvOrgAdmin(prisma, userId);
}

/** The organisation as the profile shows it, or null before setup. */
export async function organisationSummary(
  prisma: PrismaService,
): Promise<{ name: string } | null> {
  const org = await prisma.organisation.findFirst({ select: { name: true } });
  return org ? { name: org.name } : null;
}

/**
 * True when `userId` holds the only row in public.organisation_admin. Accounts
 * listed in ORG_ADMIN_EMAILS don't count as a replacement: they may have no
 * account yet, so the organisation would be left without a stored admin.
 */
export async function isLastStoredOrgAdmin(
  prisma: PrismaService,
  userId: string,
): Promise<boolean> {
  const row = await prisma.organisation_admin.findUnique({
    where: { user_id: userId },
    select: { user_id: true },
  });
  if (!row) return false;
  const others = await prisma.organisation_admin.count({
    where: { user_id: { not: userId } },
  });
  return others === 0;
}
