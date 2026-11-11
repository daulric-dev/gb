import type { PrismaService } from '@/prisma/prisma.service';

/**
 * Per-student restriction / objection flags (student.student_restriction),
 * set by staff with student:update on the student's page when a student or
 * their parent objects to, or asks to restrict, a kind of processing:
 *
 * - `no_ai`: the student's work is never sent to an AI provider.
 * - `no_similarity`: their submissions are not fingerprinted or compared
 *   (and existing fingerprints are removed).
 * - `exclude_from_analytics`: they are left out of the analytics at-risk
 *   lists (course and school). Counts and averages still include them.
 *
 * These helpers take the Prisma client directly so the services that honour
 * the flags need no new dependency.
 */
export const RESTRICTION_FLAGS = ['no_ai', 'no_similarity', 'exclude_from_analytics'] as const;
export type RestrictionFlag = (typeof RESTRICTION_FLAGS)[number];

export interface StudentRestrictions {
  noAi: boolean;
  noSimilarity: boolean;
  excludeFromAnalytics: boolean;
  /** Who made the last change (a staff user_profile id) and when; null if never set. */
  setBy: string | null;
  setAt: string | null;
}

/** The restriction the AI feature refuses with (403 body `code`). */
export const AI_STUDENT_RESTRICTED = 'AI_STUDENT_RESTRICTED';
export const AI_STUDENT_RESTRICTED_MESSAGE =
  "This student's work is restricted from AI processing. A member of staff with permission to edit students can change this on the student's page.";

/** The students among `studentIds` with `flag` set. One query. */
export async function restrictedStudents(
  prisma: PrismaService,
  flag: RestrictionFlag,
  studentIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.student_restriction.findMany({
    where: { student_id: { in: ids }, [flag]: true },
    select: { student_id: true },
  });
  return new Set((rows ?? []).map((r) => r.student_id));
}

/** Whether one student has `flag` set. */
export async function isRestricted(
  prisma: PrismaService,
  flag: RestrictionFlag,
  studentId: string,
): Promise<boolean> {
  return (await restrictedStudents(prisma, flag, [studentId])).has(studentId);
}
