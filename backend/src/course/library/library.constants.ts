/** BullMQ queue for library imports (Redis mode only). */
export const QUEUE_LIBRARY_IMPORT = 'course-library-import';

export interface LibraryImportJobData {
  importId: string;
}

/** Attempts per import, in both modes. */
export const LIBRARY_IMPORT_ATTEMPTS = 3;

export const LIBRARY_IMPORT_JOB_OPTS = {
  attempts: LIBRARY_IMPORT_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** One job per import: enqueueing the same import twice is a no-op. */
export const libraryImportJobId = (importId: string) => `library-import-${importId}`;

/** An import untouched this long (queued or copying) is resumed by the sweep. */
export const LIBRARY_IMPORT_STALE_MS = 10 * 60 * 1000;
/** How often the resume sweep runs (and once on boot). */
export const LIBRARY_IMPORT_RESUME_TICK_MS = 5 * 60 * 1000;
/** Advisory lock: one instance sweeps at a time. */
export const LIBRARY_IMPORT_RESUME_LOCK = 'gradebook:library-import-resume';
