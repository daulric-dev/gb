import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import {
  compileObjectKeys,
  compileStep,
  isUuid,
  validatePlan,
  type ReplayStep,
} from './erasure-plan';
import { dayPath, toEntry, verifyEntry, type ErasureEntry } from './erasure-log.service';
import { erasureLogPrefix } from './erasure.config';

export interface ReplayOptions {
  dryRun?: boolean;
  /** Accept storage/file entries without a valid signature. */
  allowUnsigned?: boolean;
}

export interface EntryResult {
  id: string;
  occurredAt: string;
  kind: string;
  /** Rows deleted or changed (would be, in a dry run). */
  rows: number;
  /** Storage objects deleted (found, in a dry run). */
  objects: number;
  /** The entry was missing from erasure_log and was added back. */
  restoredLogRow: boolean;
  error?: string;
}

export interface ReplaySummary {
  entries: number;
  applied: number;
  unchanged: number;
  failed: number;
  rows: number;
  objects: number;
  results: EntryResult[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Union of entry lists, one per id, in the order they happened. */
export function mergeEntries(...lists: ErasureEntry[][]): ErasureEntry[] {
  const byId = new Map<string, ErasureEntry>();
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Basic shape check for an entry read from outside the database. */
function isEntry(v: unknown): v is ErasureEntry {
  const e = v as ErasureEntry;
  return (
    !!e &&
    typeof e === 'object' &&
    isUuid(e.id) &&
    typeof e.occurred_at === 'string' &&
    !Number.isNaN(new Date(e.occurred_at).getTime()) &&
    typeof e.kind === 'string' &&
    typeof e.subject_table === 'string' &&
    Array.isArray(e.subject_ids) &&
    typeof e.actor === 'string' &&
    typeof e.reason === 'string'
  );
}

/**
 * Re-applies logged erasures to the current database - run right after a
 * restore, with the backup's timestamp. Every step is idempotent, each entry
 * runs in its own transaction, and storage objects are deleted before the
 * rows that name them, so a failure part-way leaves something a re-run
 * finishes.
 */
@Injectable()
export class ErasureReplayService {
  private readonly logger = new Logger(ErasureReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async fromDb(since: Date): Promise<ErasureEntry[]> {
    const rows = await this.prisma.erasure_log.findMany({
      where: { occurred_at: { gte: since } },
      orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEntry);
  }

  /** Entries in the storage copy from `since` on (signatures checked). */
  async fromStorage(since: Date, opts: ReplayOptions = {}): Promise<ErasureEntry[]> {
    const prefix = erasureLogPrefix();
    if (!prefix) return [];
    // One listing per day folder from `since` to tomorrow (a restore goes
    // back weeks, not years). Per-day prefixes rather than StartAfter, which
    // some S3-compatible stores do not honour.
    const keys: string[] = [];
    const end = Date.now() + DAY_MS;
    for (let day = startOfUtcDay(since); day <= end; day += DAY_MS) {
      keys.push(...(await this.storage.listKeys(dayPath(prefix, new Date(day)))));
    }
    const out: ErasureEntry[] = [];
    for (const key of keys) {
      if (!key.endsWith('.json')) continue;
      const buf = await this.storage.getBuffer(key);
      if (!buf) continue;
      const entry = this.parse(buf.toString('utf8'), key, opts);
      if (entry && new Date(entry.occurred_at) >= since) out.push(entry);
    }
    return out;
  }

  /** Entries from a JSON Lines file (one entry per line, as exported). */
  async fromFile(path: string, since: Date, opts: ReplayOptions = {}): Promise<ErasureEntry[]> {
    const text = await readFile(path, 'utf8');
    const out: ErasureEntry[] = [];
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const entry = this.parse(line, `${path}:${i + 1}`, opts);
      if (entry && new Date(entry.occurred_at) >= since) out.push(entry);
    });
    return out;
  }

  private parse(text: string, where: string, opts: ReplayOptions): ErasureEntry | null {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`${where}: not JSON`);
    }
    if (!isEntry(value)) throw new Error(`${where}: not an erasure log entry`);
    if (!verifyEntry(value) && !opts.allowUnsigned) {
      throw new Error(`${where}: bad or missing signature (was AUTH_SECRET changed? --allow-unsigned overrides)`);
    }
    return value;
  }

  async replay(entries: ErasureEntry[], opts: ReplayOptions = {}): Promise<ReplaySummary> {
    const summary: ReplaySummary = {
      entries: entries.length,
      applied: 0,
      unchanged: 0,
      failed: 0,
      rows: 0,
      objects: 0,
      results: [],
    };
    for (const entry of mergeEntries(entries)) {
      let result: EntryResult;
      try {
        result = await this.applyEntry(entry, opts);
      } catch (err) {
        result = {
          id: entry.id,
          occurredAt: entry.occurred_at,
          kind: entry.kind,
          rows: 0,
          objects: 0,
          restoredLogRow: false,
          error: (err as Error).message,
        };
      }
      summary.results.push(result);
      if (result.error) summary.failed++;
      else if (result.rows + result.objects > 0 || result.restoredLogRow) summary.applied++;
      else summary.unchanged++;
      summary.rows += result.rows;
      summary.objects += result.objects;
    }
    return summary;
  }

  /** Apply (or, with dryRun, measure) one entry. */
  async applyEntry(entry: ErasureEntry, opts: ReplayOptions = {}): Promise<EntryResult> {
    validatePlan(entry.replay);
    const occurredAt = new Date(entry.occurred_at);
    const steps = entry.replay.steps;
    const result: EntryResult = {
      id: entry.id,
      occurredAt: entry.occurred_at,
      kind: entry.kind,
      rows: 0,
      objects: 0,
      restoredLogRow: false,
    };

    // Storage first: once the rows are gone their keys are unknown, so a
    // storage failure must happen while the rows (and this entry) remain.
    const keys = await this.objectKeysFor(steps);
    result.objects = keys.length;
    if (!opts.dryRun && keys.length > 0) await this.storage.delete(keys);

    if (opts.dryRun) {
      for (const step of steps) {
        if (step.op === 'delete_storage_prefix') continue;
        const { sql, params } = compileStep(step, occurredAt, 'count');
        const rows = await this.prisma.$queryRawUnsafe<{ n: number }[]>(sql, ...params);
        result.rows += Number(rows?.[0]?.n ?? 0);
      }
      const known = await this.prisma.erasure_log.count({ where: { id: entry.id } });
      result.restoredLogRow = known === 0;
      return result;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const step of steps) {
        if (step.op === 'delete_storage_prefix') continue;
        const { sql, params } = compileStep(step, occurredAt);
        result.rows += await tx.$executeRawUnsafe(sql, ...params);
      }
      // Put the entry back in the restored log, so the database is complete
      // again and a later restore of a newer backup still has it.
      const added = await tx.erasure_log.createMany({
        data: [
          {
            id: entry.id,
            occurred_at: occurredAt,
            kind: entry.kind,
            subject_table: entry.subject_table,
            subject_ids: entry.subject_ids,
            school_id: entry.school_id,
            actor: entry.actor,
            reason: entry.reason,
            replay: entry.replay as unknown as Prisma.InputJsonValue,
            exported_at: entry.sig ? new Date() : null,
          },
        ],
        skipDuplicates: true,
      });
      result.restoredLogRow = added.count > 0;
    });
    return result;
  }

  /** Storage keys the entry's steps would delete, as they stand now. */
  private async objectKeysFor(steps: ReplayStep[]): Promise<string[]> {
    const keys: string[] = [];
    for (const step of steps) {
      if (step.op === 'delete_storage_prefix') {
        for (const prefix of step.prefixes) keys.push(...(await this.storage.listKeys(prefix)));
      } else if (step.op === 'delete' && step.objects) {
        const { sql, params } = compileObjectKeys(step);
        const rows = await this.prisma.$queryRawUnsafe<{ bucket: string; storage_path: string }[]>(sql, ...params);
        for (const r of rows ?? []) keys.push(objectKey(r.bucket, r.storage_path));
      }
    }
    return [...new Set(keys)];
  }

  /**
   * Re-run only the storage steps of recent entries of one kind - the
   * retention job uses it to finish object deletions that failed when an
   * account was deleted.
   */
  async retryStorage(kind: string, since: Date): Promise<number> {
    const entries = await this.prisma.erasure_log.findMany({
      where: { kind, occurred_at: { gte: since } },
      select: { replay: true },
    });
    let deleted = 0;
    for (const e of entries) {
      try {
        validatePlan(e.replay);
      } catch {
        continue;
      }
      const prefixSteps = e.replay.steps.filter((s) => s.op === 'delete_storage_prefix');
      const keys = await this.objectKeysFor(prefixSteps);
      if (keys.length > 0) {
        await this.storage.delete(keys);
        deleted += keys.length;
      }
    }
    if (deleted > 0) this.logger.log(`Removed ${deleted} leftover object(s) of erased ${kind}s`);
    return deleted;
  }
}
