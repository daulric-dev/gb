import type { Prisma } from '@/generated/prisma/client';

/** The roles every school starts with (`school_role.is_system`). */
export const SYSTEM_ROLE_NAMES = ['admin', 'teacher', 'member'] as const;

type RoleDb = Pick<Prisma.TransactionClient, 'school_role'>;

/**
 * Give a school its system roles, skipping any it already has, so calling
 * it twice is harmless. Call it in the transaction that creates the school.
 * This replaces the PostgreSQL trigger `seed_school_system_roles_trigger`
 * (dropped by migration 20261207100000_portable_database_functions); every
 * code path that creates a school must call it.
 */
export async function seedSchoolSystemRoles(db: RoleDb, schoolId: string): Promise<void> {
  const existing = await db.school_role.findMany({
    where: { school_id: schoolId, name: { in: [...SYSTEM_ROLE_NAMES] } },
    select: { name: true },
  });
  const have = new Set(existing.map((r) => r.name));
  const missing = SYSTEM_ROLE_NAMES.filter((name) => !have.has(name));
  if (missing.length === 0) return;
  await db.school_role.createMany({
    data: missing.map((name) => ({ school_id: schoolId, name, is_system: true })),
  });
}
