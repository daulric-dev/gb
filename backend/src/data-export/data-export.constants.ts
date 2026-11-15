import { envInt } from '@/erasure/erasure.config';

/** BullMQ queue for building exports (Redis mode only). */
export const QUEUE_DATA_EXPORT = 'data-export';

export interface DataExportJobData {
  exportId: string;
}

/** Attempts per export, in both modes. */
export const EXPORT_JOB_ATTEMPTS = 3;

export const EXPORT_JOB_OPTS = {
  attempts: EXPORT_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Where the ZIPs live in object storage. */
export const EXPORT_PREFIX = 'data-exports/';
export const exportKey = (id: string) => `${EXPORT_PREFIX}${id}.zip`;

/** How long a finished export can be downloaded (DATA_EXPORT_TTL_HOURS, 1-168, default 24). */
export function exportTtlHours(): number {
  return Math.min(168, Math.max(1, envInt('DATA_EXPORT_TTL_HOURS', 24)));
}

/** Largest stored file copied into an export (DATA_EXPORT_MAX_FILE_MB, default 100). */
export function maxObjectBytes(): number {
  return Math.max(1, envInt('DATA_EXPORT_MAX_FILE_MB', 100)) * 1024 * 1024;
}

/** Most bytes of stored files per export (DATA_EXPORT_MAX_TOTAL_MB, default 500). */
export function maxTotalObjectBytes(): number {
  return Math.max(1, envInt('DATA_EXPORT_MAX_TOTAL_MB', 500)) * 1024 * 1024;
}

/** A signed download URL lives this long (seconds). */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/** Expired rows (ids and status only) are deleted after this many days. */
export const EXPIRED_ROW_DAYS = 30;

/** A pending/running export nobody has touched for this long is resumed. */
export const STALE_MS = 15 * 60 * 1000;

/** The sweep (purge + resume) runs this often. */
export const SWEEP_TICK_MS = 10 * 60 * 1000;
export const SWEEP_LOCK = 'gradebook:data-export-sweep';

export const ACTIVE_STATUSES = ['pending', 'running'] as const;
export type ExportStatus = 'pending' | 'running' | 'ready' | 'failed' | 'expired';

/** Per-route limits (the `route` throttler). */
export const REQUEST_THROTTLE = { route: { limit: 5, ttl: 60 * 60 * 1000 } };
export const DOWNLOAD_THROTTLE = { route: { limit: 20, ttl: 60 * 60 * 1000 } };

/** Permission keys (catalog: src/permission/permission.catalog.ts). */
export const STUDENT_EXPORT = 'student:export';
