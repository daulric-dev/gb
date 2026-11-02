import type { Prisma } from '@/generated/prisma/client';

type Role = Prisma.school_managementCreateInput['role'];

/**
 * Create or update a user's membership row in a school with `role`, returning
 * its id. Not a Prisma `upsert`: `school_id` is unique only for admin rows (a
 * partial index), and Prisma's native upsert turns that into an ON CONFLICT
 * target Postgres rejects (42P10). Run it inside the caller's transaction.
 */
export async function setSchoolMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  schoolId: string,
  role: Role,
): Promise<{ id: string }> {
  const existing = await tx.school_management.findUnique({
    where: { user_id_school_id: { user_id: userId, school_id: schoolId } },
    select: { id: true },
  });
  if (existing) {
    return tx.school_management.update({
      where: { id: existing.id },
      data: { role, updated_at: new Date() },
      select: { id: true },
    });
  }
  return tx.school_management.create({
    data: { user_id: userId, school_id: schoolId, role, updated_at: new Date() },
    select: { id: true },
  });
}
