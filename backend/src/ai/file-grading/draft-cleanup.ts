import type { Prisma } from '@/generated/prisma/client';

type DraftTx = Pick<Prisma.TransactionClient, 'ai_grading_draft'>;

/**
 * Drops the AI grading drafts of these students on this activity. Called in
 * the same transaction as every write that marks the work (a score, a rubric
 * marking, a gradebook import): once a teacher has saved a mark the draft
 * has done its job, and a stale draft must not sit next to a newer mark.
 * Pure Prisma, so the grading services need no AI dependency.
 */
export async function clearAiGradingDrafts(tx: DraftTx, activityId: string, studentIds: string[]): Promise<number> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const { count } = await tx.ai_grading_draft.deleteMany({
    where: { activity_id: activityId, student_id: { in: ids } },
  });
  return count;
}
