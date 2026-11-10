/** BullMQ queue for report card PDF generation (Redis mode only). */
export const QUEUE_REPORT_CARD_GENERATE = 'report-card-generate';

/** Generate (or regenerate) one student's term report PDF. */
export interface ReportCardJobData {
  schoolId: string;
  termId: string;
  studentId: string;
  /**
   * Attempts already made before this job (a run resumed after a restart
   * gets only the attempts left). Absent: 0.
   */
  attemptOffset?: number;
}

/** Attempts per job, in both modes. */
export const REPORT_JOB_ATTEMPTS = 3;

export const REPORT_JOB_OPTS = {
  attempts: REPORT_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/**
 * The BullMQ job id for one student's report in one publish. Re-enqueuing the
 * same publish (a double click, a retry of the publish request) is then a
 * no-op while the first job is still queued; a later publish has a new
 * timestamp and generates afresh.
 */
export function reportJobId(data: ReportCardJobData, publishedAt: Date): string {
  return `report-${data.termId}-${data.studentId}-${publishedAt.getTime()}`;
}

/** The job id for a row the resume sweep puts back on the queue. */
export function resumeJobId(data: ReportCardJobData, at: Date): string {
  return `report-resume-${data.termId}-${data.studentId}-${at.getTime()}`;
}

/**
 * Resuming generation that a restart (or a crash between publish and
 * enqueue) left behind: a `pending` row of a published term whose
 * `updated_at` is older than this is picked up again by the sweep. Rows a
 * live process is still working through are kept fresh by its heartbeat.
 */
export const REPORT_RESUME_STALE_MS = 10 * 60 * 1000;
/** How often an inline batch touches the rows it still holds. */
export const REPORT_HEARTBEAT_MS = 2 * 60 * 1000;
/** How often the resume sweep runs (and once on boot). */
export const REPORT_RESUME_TICK_MS = 5 * 60 * 1000;
/** Most rows one sweep picks up. */
export const REPORT_RESUME_BATCH = 500;
/** Advisory lock name: one instance sweeps at a time. */
export const REPORT_RESUME_LOCK = 'gradebook:report-card-resume';
