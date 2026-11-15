import type { PrismaService } from '@/prisma/prisma.service';
import type { MessageCipher } from '@/chat/message-cipher.service';
import type { ParentSettings } from '@/parent-portal/parent-settings';

/**
 * Who an export is for, which decides what goes in it:
 * - `self`: a person's own account, whatever its type (staff, student,
 *   parent). Everything held about them, except staff-only records about a
 *   student (pastoral notes, at-risk rows, attendance alerts, similarity
 *   flags, draft report comments); see README.md for why.
 * - `staff`: a member of staff with `student:export` answering a subject
 *   access request for a student of their school: the student record and
 *   the student's linked account, including the staff-only records, minus
 *   pastoral notes withheld under an exemption (and notes the exporter
 *   could not see in the app).
 * - `parent`: a parent for a linked child, limited to what the school shows
 *   parents in the parent portal (parent_settings).
 */
export type ExportScope = 'self' | 'staff' | 'parent';

/** The database `kind` for each scope. */
export const KIND_OF_SCOPE: Record<ExportScope, 'self' | 'student' | 'child'> = {
  self: 'self',
  staff: 'student',
  parent: 'child',
};

/** What the exporter may see of pastoral notes (staff exports only). */
export interface PastoralView {
  /** pastoral-note:read: every non-safeguarding note of the school. */
  read: boolean;
  /** pastoral-note:safeguarding as well: safeguarding notes too. */
  safeguarding: boolean;
  /** The pastoral_notes feature is on for the school. */
  enabled: boolean;
}

export interface ExportSubject {
  scope: ExportScope;
  /** The exported person's account (user_profile id), if they have one. */
  userId: string | null;
  /** The exported person's student records (one per school at most). */
  studentIds: string[];
  /**
   * Staff and parent exports: only data held by this school. Null for self
   * exports (everything, in every school).
   */
  schoolId: string | null;
  /** Staff exports: who is running it (their own notes, permissions). */
  exporterId: string;
  pastoral?: PastoralView;
  /**
   * Staff exports: the exporter holds `student:sensitive` (accommodation
   * reasons, guardian contact details). Self exports always see their own.
   */
  sensitive?: boolean;
  /** Parent exports: what the school shows parents. */
  parentSettings?: ParentSettings;
  /**
   * Include account-level data (sign-in identities, sessions, devices).
   * True for self exports, and for staff exports of a student account.
   */
  accountData: boolean;
}

/** A stored object to copy into the ZIP. */
export interface ExportObject {
  /** Path inside the ZIP (under `files/`). */
  path: string;
  /** Object storage key. */
  key: string;
  /** Size recorded in the database, if known (bytes). */
  size?: number | null;
}

export interface CollectorResult {
  /** JSON-serialisable rows (or one object) for `<collector id>.json`. */
  data: unknown;
  /** Number of records, for the manifest and README. */
  count: number;
  /** Stored objects (uploads, report PDFs) to copy in. */
  objects?: ExportObject[];
  /** Numbers kept for staff, never written into the ZIP. */
  internal?: Record<string, number>;
}

export interface ExportContext {
  prisma: PrismaService;
  cipher: Pick<MessageCipher, 'decrypt'>;
  subject: ExportSubject;
  now: Date;
}

/**
 * One category of personal data. `covers` names every person column
 * (`schema.table.column`) whose rows this collector exports; the registry
 * test checks that every person column in the Prisma schema is covered by a
 * collector or excluded with a reason (registry.ts).
 */
export interface Collector {
  /** File name in the ZIP (`<id>.json`). */
  id: string;
  title: string;
  /** One or two plain sentences for README.txt. */
  description: string;
  covers: readonly string[];
  scopes: readonly ExportScope[];
  /** Parent exports: the parent_settings switch this category needs. */
  parentSetting?: keyof Omit<ParentSettings, 'maxStudentAge'>;
  collect(ctx: ExportContext): Promise<CollectorResult>;
}
