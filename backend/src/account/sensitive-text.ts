import { Logger } from '@nestjs/common';
import type { PrismaService } from '@/prisma/prisma.service';
import { withJobLease } from '@/common/job-lease';
import { isSealedWithCurrentDataKey, openSecret, sealSecret } from './secret-box';
import type { RotationCount } from './secret-rotation';

/**
 * Free-text columns about students that are encrypted at rest with
 * secret-box (AES-256-GCM; DATA_ENCRYPTION_KEY when set, else AUTH_SECRET):
 *
 * - student.pastoral_note.body (the note text);
 * - student.pastoral_note.sar_withheld_reason (why a note is withheld from
 *   subject access exports; its own `info`, same row-id AAD);
 * - grading.activity_accommodation.reason and
 *   grading.student_accommodation.reason (why a student has extra time).
 *
 * Each column has its own HKDF `info`, and the additional authenticated
 * data is `<table>:<row id>`, so a value copied to another row or column
 * does not decrypt. The services seal on write and open on read, so the API
 * contracts are unchanged.
 *
 * Rows written before encryption hold plain text. A stored value counts as
 * sealed only when it has the exact secret-box shape (SEALED below), so
 * old plain text is still read as it is until `encryptSensitiveText` (run
 * at boot by SensitiveTextBackfillService, and by `bun run
 * secrets:reencrypt`) rewrites it. Nothing searches or sorts on these
 * columns.
 */
export type SensitiveField =
  | 'pastoral_note.body'
  | 'pastoral_note.sar_withheld_reason'
  | 'activity_accommodation.reason'
  | 'student_accommodation.reason';

interface FieldSpec {
  /** Report name. */
  name: string;
  /** Prisma model holding the column. */
  model: 'pastoral_note' | 'activity_accommodation' | 'student_accommodation';
  table: string;
  column: string;
  aadPrefix: string;
  info: string;
}

export const SENSITIVE_FIELDS: Record<SensitiveField, FieldSpec> = {
  'pastoral_note.body': {
    name: 'pastoralNotes',
    model: 'pastoral_note',
    table: 'student.pastoral_note',
    column: 'body',
    aadPrefix: 'pastoral_note',
    info: 'gradebook:pastoral-note-body:v1',
  },
  'pastoral_note.sar_withheld_reason': {
    name: 'pastoralSarWithheldReasons',
    model: 'pastoral_note',
    table: 'student.pastoral_note',
    column: 'sar_withheld_reason',
    aadPrefix: 'pastoral_note',
    info: 'gradebook:pastoral-note-sar-withheld-reason:v1',
  },
  'activity_accommodation.reason': {
    name: 'activityAccommodations',
    model: 'activity_accommodation',
    table: 'grading.activity_accommodation',
    column: 'reason',
    aadPrefix: 'activity_accommodation',
    info: 'gradebook:accommodation-reason:v1',
  },
  'student_accommodation.reason': {
    name: 'studentAccommodations',
    model: 'student_accommodation',
    table: 'grading.student_accommodation',
    column: 'reason',
    aadPrefix: 'student_accommodation',
    info: 'gradebook:accommodation-reason:v1',
  },
};

/**
 * The exact shape secret-box writes: v1:<iv 12 bytes>:<tag 16 bytes>:<ct>
 * or v2:<12 hex key id>:<iv>:<tag>:<ct>, all base64. Plain text matching it
 * by accident is not realistic.
 */
export const SEALED_PATTERN =
  '^(v1|v2:[0-9a-f]{12}):[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]*={0,2}$';
const SEALED = new RegExp(SEALED_PATTERN);

/** Shown in place of a value that cannot be decrypted with the keys set. */
export const UNREADABLE_TEXT = '[This text could not be decrypted. Check DATA_ENCRYPTION_KEY.]';

const logger = new Logger('SensitiveText');

export function isSealedText(stored: string): boolean {
  return SEALED.test(stored);
}

function aad(field: SensitiveField, rowId: string): Buffer {
  return Buffer.from(`${SENSITIVE_FIELDS[field].aadPrefix}:${rowId.toLowerCase()}`, 'utf8');
}

/** Encrypt a value for one row. */
export function sealText(field: SensitiveField, rowId: string, plain: string): string {
  return sealSecret(SENSITIVE_FIELDS[field].info, aad(field, rowId), plain);
}

/** Encrypt, keeping null as null. */
export function sealOptionalText(field: SensitiveField, rowId: string, plain: string | null | undefined): string | null {
  return plain === null || plain === undefined ? null : sealText(field, rowId, plain);
}

/**
 * The plain text of a stored value: decrypted when sealed, as it is when it
 * is old plain text, UNREADABLE_TEXT when sealed under keys no longer set.
 */
export function openText(field: SensitiveField, rowId: string, stored: string): string;
export function openText(field: SensitiveField, rowId: string, stored: string | null): string | null;
export function openText(field: SensitiveField, rowId: string, stored: string | null): string | null {
  if (stored === null) return null;
  if (!isSealedText(stored)) return stored;
  const plain = openSecret(SENSITIVE_FIELDS[field].info, aad(field, rowId), stored);
  if (plain === null) {
    logger.warn(`Could not decrypt ${field} of row ${rowId}`);
    return UNREADABLE_TEXT;
  }
  return plain;
}

type Db = Pick<PrismaService, 'job_lease' | FieldSpec['model']>;

/** The id + value page reader / compare-and-set writer, the same for each column. */
interface SensitiveDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { id: 'asc' };
    take: number;
    select: Record<string, true>;
  }): Promise<Array<Record<string, string>>>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, string> }): Promise<{ count: number }>;
}

const BATCH = 200;
const LOCK_KEY = 'gradebook:sensitive-text-backfill';
/** How long one batch may hold the lease before another instance may take over. */
const BATCH_LEASE_MS = 5 * 60_000;

const empty = (): RotationCount => ({ scanned: 0, rewritten: 0, current: 0, failed: 0, raced: 0 });

/**
 * Encrypt every plain-text value (and, with `rotate`, re-seal every value
 * not under the current DATA_ENCRYPTION_KEY). Batches of 200 by id, each
 * under a `job_lease` claim, so two API instances never work the same batch
 * at once; each row is written only if it still holds the value read (a
 * compare-and-set `updateMany`), so concurrent edits win. Idempotent.
 *
 * Values already sealed are skipped in TypeScript (`isSealedText`) rather
 * than with a database regex, so a plain run pages through every non-null
 * value but only counts and rewrites the plain ones.
 */
export async function encryptSensitiveText(
  db: Db,
  opts: { dryRun?: boolean; rotate?: boolean } = {},
): Promise<Record<string, RotationCount>> {
  const report: Record<string, RotationCount> = {};
  for (const field of Object.keys(SENSITIVE_FIELDS) as SensitiveField[]) {
    const spec = SENSITIVE_FIELDS[field];
    const count = (report[spec.name] = empty());
    const delegate = db[spec.model] as unknown as SensitiveDelegate;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      let page: Array<Record<string, string>> = [];
      const ran = await withJobLease(db, LOCK_KEY, BATCH_LEASE_MS, async () => {
        page = await delegate.findMany({
          where: { [spec.column]: { not: null }, id: { gt: after } },
          orderBy: { id: 'asc' },
          take: BATCH,
          select: { id: true, [spec.column]: true },
        });
        for (const raw of page) {
          const row = { id: raw.id, value: raw[spec.column] };
          // Plain text only, unless rotating (then every non-null value).
          if (!opts.rotate && isSealedText(row.value)) continue;
          count.scanned++;
          let next: string;
          if (isSealedText(row.value)) {
            if (isSealedWithCurrentDataKey(row.value)) {
              count.current++;
              continue;
            }
            const plain = openText(field, row.id, row.value);
            if (plain === UNREADABLE_TEXT) {
              count.failed++;
              continue;
            }
            next = sealText(field, row.id, plain);
          } else {
            next = sealText(field, row.id, row.value);
          }
          if (opts.dryRun) {
            count.rewritten++;
            continue;
          }
          const changed = await delegate.updateMany({
            where: { id: row.id, [spec.column]: row.value },
            data: { [spec.column]: next },
          });
          if (changed.count === 1) count.rewritten++;
          else count.raced++;
        }
      });
      // Another instance holds the lease: it is doing this work.
      if (!ran) return report;
      if (page.length === 0) break;
      after = page[page.length - 1].id;
    }
  }
  return report;
}
