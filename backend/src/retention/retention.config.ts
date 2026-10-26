import { envInt } from '@/erasure/erasure.config';

export const PURGE_KINDS = ['files', 'folders', 'chat_messages', 'discussion_replies'] as const;
export type PurgeKind = (typeof PURGE_KINDS)[number];

const OVERRIDE_ENV: Record<PurgeKind, string> = {
  files: 'SOFT_DELETE_RETENTION_DAYS_FILES',
  folders: 'SOFT_DELETE_RETENTION_DAYS_FOLDERS',
  chat_messages: 'SOFT_DELETE_RETENTION_DAYS_CHAT_MESSAGES',
  discussion_replies: 'SOFT_DELETE_RETENTION_DAYS_DISCUSSION_REPLIES',
};

export function retentionEnabled(): boolean {
  return (process.env.RETENTION_PURGE_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/** Days a soft-deleted row of this kind is kept before it is purged. */
export function softDeleteRetentionDays(kind: PurgeKind): number {
  return envInt(OVERRIDE_ENV[kind], envInt('SOFT_DELETE_RETENTION_DAYS', 30));
}

export const batchSize = () => Math.max(1, envInt('RETENTION_PURGE_BATCH_SIZE', 500));
export const maxRunMs = () => Math.max(1, envInt('RETENTION_PURGE_MAX_MINUTES', 10)) * 60_000;
export const intervalHours = () => Math.max(1, envInt('RETENTION_PURGE_INTERVAL_HOURS', 24));
/** UTC hour of day (0-23) the daily run starts at. */
export const runHourUtc = () => Math.min(23, envInt('RETENTION_PURGE_HOUR_UTC', 3));

/**
 * Upload tickets still `pending`, and uploads that `failed`, are removed (row
 * and object) once this old. Upload URLs live 5 minutes, so an hour leaves a
 * wide margin for a slow finalise.
 */
export const ABANDONED_UPLOAD_MS = 60 * 60 * 1000;
