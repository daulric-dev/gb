import type { PrismaService } from '@/prisma/prisma.service';

/**
 * The school a user is currently working in (`user_profile.school_id`), or
 * null. Services that need it as a precondition turn null into their own
 * "You are not assigned to a school" error.
 */
export async function userSchoolId(
  prisma: PrismaService,
  userId: string,
): Promise<string | null> {
  const profile = await prisma.user_profile.findUnique({
    where: { id: userId },
    select: { school_id: true },
  });
  return profile?.school_id ?? null;
}
