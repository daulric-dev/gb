/**
 * AI grading drafts for file-uploaded assignments (src/ai/file-grading).
 * Limits on what is read from students' files and sent to the provider.
 */

/** Largest file read (bytes). Bigger files are reported, never downloaded. */
export const AI_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Most files of one submission read; the rest are reported as skipped. */
export const AI_FILE_MAX_FILES = 10;
/** Most PDF pages read per file; the rest are reported as not read. */
export const AI_FILE_MAX_PAGES = 100;
/** Longest one file's text extraction may take (ms). */
export const AI_FILE_EXTRACT_TIMEOUT_MS = 15_000;
/** Most bytes the text part of a .docx may unpack to (zip-bomb cap). */
export const AI_DOCX_MAX_XML_BYTES = 20 * 1024 * 1024;
/** Most bytes all parts of a .docx may declare once unpacked. */
export const AI_DOCX_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** Most entries in a .docx archive. */
export const AI_DOCX_MAX_ENTRIES = 5_000;
/** Fewer letters and digits than this in a PDF: treated as scanned / image-only. */
export const AI_PDF_MIN_TEXT_CHARS = 30;

/** Put where the work was cut to fit the character limit. */
export const TRUNCATION_MARKER = '[... the rest of this work was cut here to fit the length limit and was not sent ...]';

/** Most submissions one "Draft for all ungraded" run may queue. */
export const AI_BATCH_MAX_SUBMISSIONS = 200;
/** A queued or running draft older than this is marked failed (interrupted). */
export const AI_DRAFT_STUCK_MS = 60 * 60 * 1000;
/** How often each instance sweeps stuck drafts. */
export const AI_DRAFT_SWEEP_MS = 15 * 60 * 1000;

/** Default days an AI grading draft is kept; AI_GRADING_DRAFT_RETENTION_DAYS overrides. */
export const AI_GRADING_DRAFT_RETENTION_DEFAULT_DAYS = 90;

export const DRAFT_STATUSES = ['queued', 'running', 'ready', 'failed', 'skipped', 'cancelled'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export type DraftMode = 'rubric' | 'score';

/** How each file of a submission was handled. */
export type FileReadStatus = 'read' | 'truncated' | 'unreadable' | 'skipped';

export interface FileReport {
  fileId: string | null;
  name: string;
  status: FileReadStatus;
  /** Why it was not (fully) read, in plain words. */
  reason: string | null;
  /** Characters of its text that were sent. */
  chars: number;
  pages: number | null;
}

/** BullMQ queue for AI grading drafts (Redis mode only). */
export const QUEUE_AI_FILE_GRADING = 'ai-file-grading';
export interface AiGradingJobData {
  draftId: string;
}
/** One job per draft: a re-queue of the same draft before it runs is a no-op. */
export const aiGradingJobId = (draftId: string) => `ai-grading-${draftId}`;
export const AI_GRADING_JOB_OPTS = {
  // A provider error is recorded on the draft; the job itself does not retry
  // (each attempt would be another paid request).
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: 1000,
};
/** Jobs run at once per instance: AI requests are slow and count toward the hourly limit. */
export const AI_GRADING_CONCURRENCY = 2;

/** Error / skip codes stored on a draft and shown to the teacher. */
export const DRAFT_CODES = {
  restricted: 'AI_STUDENT_RESTRICTED',
  nothingReadable: 'NOTHING_READABLE',
  notHandedIn: 'NOT_HANDED_IN',
  graded: 'ALREADY_GRADED',
  settingOff: 'AI_STUDENT_FILES_NOT_ALLOWED',
  cancelled: 'CANCELLED',
  interrupted: 'INTERRUPTED',
} as const;
