import { Logger } from '@nestjs/common';
import type { PrismaService } from '@/prisma/prisma.service';
import { isSealedWithCurrentDataKey, openSecret, sealSecret } from './secret-box';
import type { RotationCount } from './secret-rotation';

/**
 * Free-text columns about students that are encrypted at rest with
 * secret-box (AES-256-GCM; DATA_ENCRYPTION_KEY when set, else AUTH_SECRET):
 *
 * - student.pastoral_note.body (the note text);
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
export type SensitiveField = 'pastoral_note.body' | 'activity_accommodation.reason' | 'student_accommodation.reason';

interface FieldSpec {
  /** Report name. */
  name: string;
  table: string;
  column: string;
  aadPrefix: string;
  info: string;
}

export const SENSITIVE_FIELDS: Record<SensitiveField, FieldSpec> = {
  'pastoral_note.body': {
    name: 'pastoralNotes',
    table: 'student.pastoral_note',
    column: 'body',
    aadPrefix: 'pastoral_note',
    info: 'gradebook:pastoral-note-body:v1',
  },
  'activity_accommodation.reason': {
    name: 'activityAccommodations',
    table: 'grading.activity_accommodation',
    column: 'reason',
    aadPrefix: 'activity_accommodation',
    info: 'gradebook:accommodation-reason:v1',
  },
  'student_accommodation.reason': {
    name: 'studentAccommodations',
    table: 'grading.student_accommodation',
    column: 'reason',
    aadPrefix: 'student_accommodation',
    info: 'gradebook:accommodation-reason:v1',
  },
};

/**
 * The exact shape secret-box writes: v1:<iv 12 bytes>:<tag 16 bytes>:<ct>
 * or v2:<12 hex key id>:<iv>:<tag>:<ct>, all base64. Plain text matching it
 * by accident is not realistic. Kept as a string so SQL can use it too.
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

type Db = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'>;

const BATCH = 200;
const LOCK_KEY = 'gradebook:sensitive-text-backfill';

const empty = (): RotationCount => ({ scanned: 0, rewritten: 0, current: 0, failed: 0, raced: 0 });

/**
 * Encrypt every plain-text value (and, with `rotate`, re-seal every value
 * not under the current DATA_ENCRYPTION_KEY). Batches of 200 by id, each in
 * its own transaction holding a transaction-level advisory lock, so two API
 * instances never work the same batch at once; each row is written only if
 * it still holds the value read, so concurrent edits win. Idempotent.
 */
export async function encryptSensitiveText(
  db: Db,
  opts: { dryRun?: boolean; rotate?: boolean } = {},
): Promise<Record<string, RotationCount>> {
  const report: Record<string, RotationCount> = {};
  for (const field of Object.keys(SENSITIVE_FIELDS) as SensitiveField[]) {
    const spec = SENSITIVE_FIELDS[field];
    const count = (report[spec.name] = empty());
    // Plain text only, unless rotating (then every non-null value).
    const filter = opts.rotate ? '' : `AND ${spec.column} !~ $3`;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await db.$transaction(async (tx) => {
        const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
          LOCK_KEY,
        );
        if (!lock[0]?.locked) return null;
        const batch = await tx.$queryRawUnsafe<{ id: string; value: string }[]>(
          `SELECT id::text AS id, ${spec.column} AS value FROM ${spec.table}
           WHERE ${spec.column} IS NOT NULL AND id > $1::uuid ${filter}
           ORDER BY id LIMIT $2`,
          after,
          BATCH,
          ...(opts.rotate ? [] : [SEALED_PATTERN]),
        );
        for (const row of batch) {
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
          const changed = await tx.$executeRawUnsafe(
            `UPDATE ${spec.table} SET ${spec.column} = $1 WHERE id = $2::uuid AND ${spec.column} = $3`,
            next,
            row.id,
            row.value,
          );
          if (changed === 1) count.rewritten++;
          else count.raced++;
        }
        return batch;
      });
      // Another instance holds the lock: it is doing this work.
      if (rows === null) return report;
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;
    }
  }
  return report;
}
