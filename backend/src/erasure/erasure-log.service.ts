import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import {
  ERASURE_KINDS,
  ERASURE_REASONS,
  isUuid,
  REGISTRY,
  validatePlan,
  type ErasureKind,
  type ErasureReason,
  type ReplayPlan,
} from './erasure-plan';
import { erasureLogCutoff, erasureLogPrefix, signingKey } from './erasure.config';

/** Prisma client or interactive-transaction client. */
export type Db = Prisma.TransactionClient | PrismaService;

export interface ErasureInput {
  kind: ErasureKind;
  /** `schema.table` of the subject rows, e.g. `file_manager.file`. */
  subjectTable: string;
  subjectIds: string[];
  schoolId?: string | null;
  /** The user who asked for it, or 'system'. */
  actor: string;
  reason: ErasureReason;
  replay: ReplayPlan;
}

/** An entry as exported and as read back for replay. */
export interface ErasureEntry {
  v: 1;
  id: string;
  occurred_at: string;
  kind: string;
  subject_table: string;
  subject_ids: string[];
  school_id: string | null;
  actor: string;
  reason: string;
  replay: ReplayPlan;
  sig?: string;
}

type Row = {
  id: string;
  occurred_at: Date;
  kind: string;
  subject_table: string;
  subject_ids: string[];
  school_id: string | null;
  actor: string;
  reason: string;
  replay: unknown;
};

const EXPORT_DELAY_MS = 2_000;
const EXPORT_BATCH = 200;

/** JSON with object keys sorted at every level, so signatures are stable. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signEntry(entry: Omit<ErasureEntry, 'sig'>): string {
  return createHmac('sha256', signingKey()).update(stableStringify(entry)).digest('base64url');
}

export function verifyEntry(entry: ErasureEntry): boolean {
  if (!entry.sig) return false;
  const { sig, ...rest } = entry;
  const expected = Buffer.from(signEntry(rest));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function toEntry(row: Row): ErasureEntry {
  return {
    v: 1,
    id: row.id,
    occurred_at: row.occurred_at.toISOString(),
    kind: row.kind,
    subject_table: row.subject_table,
    subject_ids: row.subject_ids,
    school_id: row.school_id,
    actor: row.actor,
    reason: row.reason,
    replay: row.replay as ReplayPlan,
  };
}

/** `<prefix>/YYYY/MM/DD/` for a date; keys sort by time under it. */
export function dayPath(prefix: string, at: Date): string {
  const iso = at.toISOString();
  return `${prefix}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/`;
}

export function objectKeyFor(prefix: string, entry: { id: string; occurred_at: string }): string {
  const at = new Date(entry.occurred_at);
  const stamp = at.toISOString().replace(/[-:]/g, '');
  return `${dayPath(prefix, at)}${stamp}-${entry.id}.json`;
}

/**
 * The GDPR erasure log (see README). `record()` is called by every erasure
 * path with the transaction client the erasure runs in, so the entry commits
 * or rolls back with it. After commit the entry is copied to object storage
 * (transactional outbox: rows with `exported_at IS NULL` are retried by the
 * retention scheduler), because a database restore rolls this table back.
 */
@Injectable()
export class ErasureLogService implements OnModuleDestroy {
  private readonly logger = new Logger(ErasureLogService.name);
  private exportTimer?: ReturnType<typeof setTimeout>;
  private exporting?: Promise<number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleDestroy() {
    if (this.exportTimer) clearTimeout(this.exportTimer);
    this.exportTimer = undefined;
  }

  /**
   * Write one entry with `db` - pass the transaction the erasure runs in.
   * Invalid input is a programming error and throws, which rolls the
   * erasure back with it.
   */
  async record(db: Db, input: ErasureInput): Promise<string> {
    if (!ERASURE_KINDS.includes(input.kind)) throw new Error(`Unknown erasure kind ${input.kind}`);
    if (!ERASURE_REASONS.includes(input.reason)) throw new Error(`Unknown erasure reason ${input.reason}`);
    if (input.actor !== 'system' && !isUuid(input.actor)) throw new Error('Erasure actor must be a uuid or system');
    if (!REGISTRY[input.subjectTable]) throw new Error(`Unknown erasure subject table ${input.subjectTable}`);
    const ids = [...new Set(input.subjectIds)];
    if (ids.length === 0 || !ids.every(isUuid)) throw new Error('Erasure subject ids must be uuids');
    if (input.schoolId != null && !isUuid(input.schoolId)) throw new Error('Erasure school id must be a uuid');
    validatePlan(input.replay);

    const row = await db.erasure_log.create({
      data: {
        kind: input.kind,
        subject_table: input.subjectTable,
        subject_ids: ids,
        school_id: input.schoolId ?? null,
        actor: input.actor,
        reason: input.reason,
        replay: input.replay as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    this.scheduleExport();
    return row.id;
  }

  /** Export soon after the caller's transaction has (probably) committed. */
  private scheduleExport() {
    if (process.env.NODE_ENV === 'test' || !erasureLogPrefix() || this.exportTimer) return;
    this.exportTimer = setTimeout(() => {
      this.exportTimer = undefined;
      void this.exportPending().catch(() => undefined);
    }, EXPORT_DELAY_MS);
    this.exportTimer.unref?.();
  }

  /**
   * Copy committed, not-yet-exported entries to object storage, one small
   * signed JSON object each. Idempotent: an entry's key is fixed, so a
   * re-export overwrites the same object. Returns how many were exported.
   */
  async exportPending(limit = 5_000): Promise<number> {
    if (this.exporting) return this.exporting;
    this.exporting = this.doExport(limit).finally(() => {
      this.exporting = undefined;
    });
    return this.exporting;
  }

  private async doExport(limit: number): Promise<number> {
    const prefix = erasureLogPrefix();
    if (!prefix) return 0;
    let done = 0;
    while (done < limit) {
      const rows = await this.prisma.erasure_log.findMany({
        where: { exported_at: null },
        orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
        take: Math.min(EXPORT_BATCH, limit - done),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const entry = toEntry(row);
        const body = JSON.stringify({ ...entry, sig: signEntry(entry) });
        try {
          await this.storage.put(objectKeyFor(prefix, entry), body, 'application/json');
        } catch (err) {
          this.logger.warn(`Erasure log export failed (will retry): ${(err as Error).message}`);
          return done;
        }
        await this.prisma.erasure_log.updateMany({
          where: { id: row.id, exported_at: null },
          data: { exported_at: new Date() },
        });
        done++;
      }
      if (rows.length < EXPORT_BATCH) break;
    }
    if (done > 0) this.logger.log(`Exported ${done} erasure log entr${done === 1 ? 'y' : 'ies'}`);
    return done;
  }

  /**
   * Best-effort removal of storage objects after an erasure has committed:
   * exact keys plus every key under the given prefixes. A failure is logged,
   * not thrown - the erasure itself has happened, and the retention job
   * re-runs the prefix steps of recent account erasures.
   */
  async removeObjects(keys: string[], prefixes: string[] = []): Promise<number> {
    try {
      const all = new Set(keys);
      for (const prefix of prefixes) for (const k of await this.storage.listKeys(prefix)) all.add(k);
      if (all.size > 0) await this.storage.delete([...all]);
      return all.size;
    } catch (err) {
      this.logger.warn(`Storage clean-up after erasure failed (will retry): ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Drop entries older than ERASURE_LOG_RETENTION_DAYS, in the database and
   * in the storage copy. Returns the counts.
   */
  async prune(now = new Date(), dryRun = false): Promise<{ rows: number; objects: number }> {
    const cutoff = erasureLogCutoff(now);
    const rows = dryRun
      ? await this.prisma.erasure_log.count({ where: { occurred_at: { lt: cutoff } } })
      : (await this.prisma.erasure_log.deleteMany({ where: { occurred_at: { lt: cutoff } } })).count;

    let objects = 0;
    const prefix = erasureLogPrefix();
    if (prefix) {
      // Day folders sort before the cutoff's day; entries on the cutoff day
      // itself go on the next run.
      const keys = await this.storage.listKeys(`${prefix}/`, { endBefore: dayPath(prefix, cutoff) });
      objects = keys.length;
      if (!dryRun && keys.length > 0) await this.storage.delete(keys);
    }
    return { rows, objects };
  }
}
