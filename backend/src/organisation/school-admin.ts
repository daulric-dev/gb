import type { Prisma } from '@/generated/prisma/client';
import { setSchoolMembership } from '@/common/school-membership';

/** The appointee as appointing needs them: their profile id and active school. */
export interface Appointee {
  id: string;
  school_id: string | null;
}

/**
 * Make `user` the school's admin and owner, inside the caller's transaction.
 * Shared by OrganisationService.appointAdmin (an existing account) and
 * InviteService (an invite applied at first sign-in), so both have the same
 * effect:
 *
 * - A school has one admin (partial unique index), so the previous one
 *   becomes a teacher.
 * - user_profile.role mirrors the role only where the school is the user's
 *   active one; a user without an active school gets this one.
 * - The school's open admin invites are revoked: it has an admin now.
 *
 * Returns the demoted admin's id, or null. Callers clear the caches.
 */
export async function seatSchoolAdmin(
  tx: Prisma.TransactionClient,
  user: Appointee,
  schoolId: string,
  now = new Date(),
): Promise<string | null> {
  const current = await tx.school_management.findFirst({
    where: { school_id: schoolId, role: 'admin' },
    select: { id: true, user_id: true },
  });
  const demoted = current && current.user_id !== user.id ? current : null;
  if (demoted) {
    await tx.school_management.update({
      where: { id: demoted.id },
      data: { role: 'teacher', updated_at: now },
    });
    await tx.user_profile.updateMany({
      where: { id: demoted.user_id, school_id: schoolId },
      data: { role: 'teacher' },
    });
  }

  await setSchoolMembership(tx, user.id, schoolId, 'admin');
  await tx.school.update({
    where: { id: schoolId },
    data: { owner_id: user.id, updated_at: now },
  });
  if (!user.school_id) {
    await tx.user_profile.update({
      where: { id: user.id },
      data: { school_id: schoolId, role: 'admin', is_active: true },
    });
  } else if (user.school_id === schoolId) {
    await tx.user_profile.update({
      where: { id: user.id },
      data: { role: 'admin' },
    });
  }
  await tx.organisation_invite.updateMany({
    where: {
      school_id: schoolId,
      kind: 'school_admin',
      accepted_at: null,
      revoked_at: null,
    },
    data: { revoked_at: now },
  });
  return demoted?.user_id ?? null;
}
