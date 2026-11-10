/** BullMQ queue for dry runs and applies (Redis mode only). */
export const QUEUE_ROSTER_SYNC = 'roster-sync';

export type RosterJobKind = 'plan' | 'apply';
export interface RosterJobData {
  kind: RosterJobKind;
  runId: string;
}

export const ROSTER_JOB_OPTS = {
  attempts: 1,
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** HKDF info for the OAuth2 client secret (src/account/secret-box.ts). */
export const ROSTER_SECRET_INFO = 'gradebook:roster-secret:v1';
export const rosterSecretAad = (sourceId: string) => Buffer.from(`roster-source:${sourceId}`);

/** Largest upload (a zip or a CSV). */
export const ROSTER_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const ROSTER_UPLOAD_PREFIX = 'rostering/uploads/';
export const ROSTER_MAX_UPLOADS = 10;

/** Changes applied per batch between progress updates. */
export const ROSTER_APPLY_BATCH = 100;
/** An applying run whose heartbeat is older than this is resumed. */
export const ROSTER_STALE_MS = 10 * 60 * 1000;
/** A dry run still `planning` after this was interrupted. */
export const ROSTER_PLAN_STALE_MS = 30 * 60 * 1000;
/** Scheduler tick (resume + daily syncs). */
export const ROSTER_TICK_MS = 5 * 60 * 1000;
/** A daily source runs again once this has passed since its last scheduled run. */
export const ROSTER_DAILY_MS = 23.5 * 60 * 60 * 1000;
export const ROSTER_LOCK = 'gradebook:rostering-scheduler';
