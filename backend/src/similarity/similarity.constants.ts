/** BullMQ queue for similarity checks (Redis mode only). */
export const QUEUE_SIMILARITY_CHECK = 'similarity-check';

export interface SimilarityJobData {
  submissionId: string;
}

/**
 * One job per submission while it waits: a second hand-in event for the
 * same submission before the first runs is a no-op (completed jobs are
 * removed, so a later change queues again).
 */
export function similarityJobId(submissionId: string): string {
  return `similarity-${submissionId}`;
}

export const SIMILARITY_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: 1000,
};
