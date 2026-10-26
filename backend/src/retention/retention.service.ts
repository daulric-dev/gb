import { Injectable, Logger } from '@nestjs/common';
import { KNOWN_DEVICE_WINDOW_MS } from '@/account/session.config';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { objectKey, UPLOAD_STAGING_PREFIX } from '@/storage/keys';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { ErasureReplayService } from '@/erasure/erasure-replay.service';
import { plan } from '@/erasure/erasure-plan';
import {
  ABANDONED_UPLOAD_MS,
  batchSize,
  maxRunMs,
  softDeleteRetentionDays,
  type PurgeKind,
} from './retention.config';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Expired or revoked sessions and used or expired sign-in codes kept this long. */
const AUTH_LEFTOVER_MS = DAY_MS;
/** Re-run storage clean-up of account erasures this recent. */
const STORAGE_RETRY_MS = 7 * DAY_MS;

export interface PurgeOptions {
  dryRun?: boolean;
  now?: Date;
  /** Override every kind's retention (days); the CLI's --retention-days. */
  retentionDays?: number;
  /** Only consider these row ids (and skip the global clean-ups). */
  only?: string[];
}

export interface PurgeReport {
  dryRun: boolean;
  timedOut: boolean;
  files: number;
  fileObjects: number;
  folders: number;
  chatMessages: number;
  discussionRepliesDeleted: number;
  discussionRepliesScrubbed: number;
  sessions: number;
  emailCodes: number;
  /** Remembered devices (new sign-in alerts) unused for 90 days. */
  knownDevices: number;
  erasureLogRows: number;
  erasureLogObjects: number;
  leftoverObjects: number;
  /** Upload rows left `pending` or `failed` (row and object removed). */
  abandonedUploads: number;
  /** Staged upload objects no pending upload owns any more. */
  stagedObjects: number;
  exported: number;
  errors: string[];
}

class Deadline extends Error {}

const STAGED_ID_RE =
  /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[^/]*$/i;

/** The file id a staged key `.../<schoolId>/<userId>/<fileId>-<slug>` was made for. */
export function stagedFileId(key: string): string | null {
  return STAGED_ID_RE.exec(key)?.[1]?.toLowerCase() ?? null;
}

const groupBy = <T>(rows: T[], key: (r: T) => string | null) => {
  const out = new Map<string | null, T[]>();
  for (const r of rows) {
    const k = key(r);
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
};

/**
 * Hard-deletes personal data that was soft-deleted longer ago than the
 * retention period, clears expired sign-in leftovers and prunes the erasure
 * log. Every purge is recorded in the erasure log (reason
 * `retention_purge`) in the same transaction. Batched and time-boxed; each
 * kind fails on its own, and nothing here throws.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly erasure: ErasureLogService,
    private readonly replay: ErasureReplayService,
  ) {}

  async purge(opts: PurgeOptions = {}): Promise<PurgeReport> {
    const now = opts.now ?? new Date();
    const deadline = Date.now() + maxRunMs();
    const report: PurgeReport = {
      dryRun: !!opts.dryRun,
      timedOut: false,
      files: 0,
      fileObjects: 0,
      folders: 0,
      chatMessages: 0,
      discussionRepliesDeleted: 0,
      discussionRepliesScrubbed: 0,
      sessions: 0,
      emailCodes: 0,
      knownDevices: 0,
      erasureLogRows: 0,
      erasureLogObjects: 0,
      leftoverObjects: 0,
      abandonedUploads: 0,
      stagedObjects: 0,
      exported: 0,
      errors: [],
    };
    const cutoff = (kind: PurgeKind) =>
      new Date(now.getTime() - (opts.retentionDays ?? softDeleteRetentionDays(kind)) * DAY_MS);
    const ctx = { opts, deadline, report };

    const jobs: [string, () => Promise<void>][] = [
      ['files', () => this.purgeFiles(cutoff('files'), ctx)],
      ['folders', () => this.purgeFolders(cutoff('folders'), ctx)],
      ['chat messages', () => this.purgeChatMessages(cutoff('chat_messages'), ctx)],
      ['discussion replies', () => this.purgeReplies(cutoff('discussion_replies'), ctx)],
    ];
    if (!opts.only) {
      jobs.push(
        ['sign-in leftovers', () => this.purgeAuthLeftovers(now, ctx)],
        ['abandoned uploads', () => this.purgeAbandonedUploads(now, ctx)],
        ['staged upload objects', () => this.purgeStagedObjects(ctx)],
        ['erasure log', async () => {
          const pruned = await this.erasure.prune(now, opts.dryRun);
          report.erasureLogRows = pruned.rows;
          report.erasureLogObjects = pruned.objects;
        }],
        ['account storage', async () => {
          if (opts.dryRun) return;
          report.leftoverObjects = await this.replay.retryStorage(
            'account',
            new Date(now.getTime() - STORAGE_RETRY_MS),
          );
        }],
      );
    }
    if (!opts.dryRun) {
      jobs.push(['erasure log export', async () => {
        report.exported = await this.erasure.exportPending();
      }]);
    }

    for (const [label, job] of jobs) {
      try {
        await job();
      } catch (err) {
        if (err instanceof Deadline) {
          report.timedOut = true;
          this.logger.warn(`Retention purge stopped at ${label}: time budget used up`);
          break;
        }
        report.errors.push(`${label}: ${(err as Error).message}`);
        this.logger.error(`Retention purge of ${label} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Retention purge${report.dryRun ? ' (dry run)' : ''}: ${JSON.stringify({ ...report, errors: report.errors.length })}`);
    return report;
  }

  private checkTime(deadline: number) {
    if (Date.now() > deadline) throw new Deadline();
  }

  private idFilter(only?: string[]) {
    return only ? { id: { in: only } } : {};
  }

  /**
   * Files: storage object first, then the row (with its log entry). If the
   * object delete fails nothing else happens and the next run retries; if
   * the row delete fails after the object went, the next run deletes a
   * missing object (a no-op) and then the row. A file still attached to a
   * submission is part of the school's record and stays.
   */
  private async purgeFiles(cutoff: Date, { opts, deadline, report }: Ctx) {
    const where = {
      deleted_at: { lt: cutoff },
      submission: { none: {} },
      ...this.idFilter(opts.only),
    };
    if (opts.dryRun) {
      report.files = await this.prisma.file.count({ where });
      report.fileObjects = report.files;
      return;
    }
    for (;;) {
      this.checkTime(deadline);
      const rows = await this.prisma.file.findMany({
        where,
        select: { id: true, school_id: true, bucket: true, storage_path: true },
        orderBy: { deleted_at: 'asc' },
        take: batchSize(),
      });
      if (rows.length === 0) return;
      await this.storage.delete(rows.map((r) => objectKey(r.bucket, r.storage_path)));
      report.fileObjects += rows.length;
      const deleted = await this.prisma.$transaction(async (tx) => {
        const ids = rows.map((r) => r.id);
        const { count } = await tx.file.deleteMany({ where: { id: { in: ids }, deleted_at: { lt: cutoff } } });
        for (const [schoolId, group] of groupBy(rows, (r) => r.school_id)) {
          const groupIds = group.map((r) => r.id);
          await this.erasure.record(tx, {
            kind: 'file',
            subjectTable: 'file_manager.file',
            subjectIds: groupIds,
            schoolId,
            actor: 'system',
            reason: 'retention_purge',
            replay: plan.of(plan.del('file_manager.file', { id: groupIds }, true)),
          });
        }
        return count;
      });
      report.files += deleted;
      if (deleted === 0) return;
    }
  }

  /**
   * Upload tickets nobody finalised, and uploads that failed their checks:
   * object first, then the row, as for files. Not personal data kept for a
   * reason - the user never got a file - so no retention period applies
   * beyond giving a slow upload time to finish. Rows something points at
   * (a submission or module item) are left for a person to sort out.
   */
  private async purgeAbandonedUploads(now: Date, { opts, deadline, report }: Ctx) {
    const before = new Date(now.getTime() - ABANDONED_UPLOAD_MS);
    const where = {
      status: { in: ['pending' as const, 'failed' as const] },
      created_at: { lt: before },
      submission: { none: {} },
      module_item: { none: {} },
    };
    if (opts.dryRun) {
      report.abandonedUploads = await this.prisma.file.count({ where });
      return;
    }
    for (;;) {
      this.checkTime(deadline);
      const rows = await this.prisma.file.findMany({
        where,
        select: { id: true, school_id: true, bucket: true, storage_path: true },
        orderBy: { created_at: 'asc' },
        take: batchSize(),
      });
      if (rows.length === 0) return;
      await this.storage.delete(rows.map((r) => objectKey(r.bucket, r.storage_path)));
      const deleted = await this.prisma.$transaction(async (tx) => {
        const ids = rows.map((r) => r.id);
        // Re-check the status: a finalise may have won the race.
        const { count } = await tx.file.deleteMany({
          where: { id: { in: ids }, status: { in: ['pending', 'failed'] } },
        });
        for (const [schoolId, group] of groupBy(rows, (r) => r.school_id)) {
          const groupIds = group.map((r) => r.id);
          await this.erasure.record(tx, {
            kind: 'file',
            subjectTable: 'file_manager.file',
            subjectIds: groupIds,
            schoolId,
            actor: 'system',
            reason: 'retention_purge',
            replay: plan.of(plan.del('file_manager.file', { id: groupIds }, true)),
          });
        }
        return count;
      });
      report.abandonedUploads += deleted;
      if (deleted === 0) return;
    }
  }

  /**
   * Staged upload objects (`file-manager/uploads/...`) whose file row is gone
   * or no longer pending: a PUT replayed with a still-valid URL after the
   * upload was finalised, or an object whose row was purged first.
   */
  private async purgeStagedObjects({ opts, deadline, report }: Ctx) {
    if (opts.dryRun) return;
    this.checkTime(deadline);
    const prefix = objectKey('file-manager', UPLOAD_STAGING_PREFIX);
    const keys = await this.storage.listKeys(prefix);
    for (let i = 0; i < keys.length; i += batchSize()) {
      this.checkTime(deadline);
      const batch = keys.slice(i, i + batchSize());
      const idOf = new Map(batch.map((k) => [k, stagedFileId(k)]));
      const ids = [...new Set([...idOf.values()].filter((id): id is string => !!id))];
      const pending = ids.length
        ? await this.prisma.file.findMany({
            where: { id: { in: ids }, status: 'pending' },
            select: { id: true, bucket: true, storage_path: true },
          })
        : [];
      const live = new Set(pending.map((r) => objectKey(r.bucket, r.storage_path)));
      const stale = batch.filter((k) => !live.has(k));
      if (stale.length === 0) continue;
      await this.storage.delete(stale);
      report.stagedObjects += stale.length;
    }
  }

  /**
   * Folders whose soft-delete has expired, once nothing live is left in
   * them: deleting a folder cascades to its child folders (so every child
   * must be expired too) and detaches files (`folder_id` is set null).
   */
  private async purgeFolders(cutoff: Date, { opts, deadline, report }: Ctx) {
    const where = {
      deleted_at: { lt: cutoff },
      other_folder: { every: { deleted_at: { lt: cutoff } } },
      file: { none: { deleted_at: null } },
      ...this.idFilter(opts.only),
    };
    if (opts.dryRun) {
      report.folders = await this.prisma.folder.count({ where });
      return;
    }
    for (;;) {
      this.checkTime(deadline);
      const rows = await this.prisma.folder.findMany({
        where,
        select: { id: true, school_id: true },
        orderBy: { deleted_at: 'asc' },
        take: batchSize(),
      });
      if (rows.length === 0) return;
      const deleted = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.folder.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        for (const [schoolId, group] of groupBy(rows, (r) => r.school_id)) {
          const ids = group.map((r) => r.id);
          await this.erasure.record(tx, {
            kind: 'folder',
            subjectTable: 'file_manager.folder',
            subjectIds: ids,
            schoolId,
            actor: 'system',
            reason: 'retention_purge',
            replay: plan.of(plan.del('file_manager.folder', { id: ids })),
          });
        }
        return count;
      });
      report.folders += deleted;
      if (deleted === 0) return;
    }
  }

  /**
   * Chat messages are flat (nothing points at a message), so a deleted
   * message's tombstone is simply removed once its retention is over.
   */
  private async purgeChatMessages(cutoff: Date, { opts, deadline, report }: Ctx) {
    const where = { deleted_at: { lt: cutoff }, ...this.idFilter(opts.only) };
    if (opts.dryRun) {
      report.chatMessages = await this.prisma.message.count({ where });
      return;
    }
    for (;;) {
      this.checkTime(deadline);
      const rows = await this.prisma.message.findMany({
        where,
        select: { id: true, school_id: true },
        orderBy: { deleted_at: 'asc' },
        take: batchSize(),
      });
      if (rows.length === 0) return;
      const deleted = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.message.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        for (const [schoolId, group] of groupBy(rows, (r) => r.school_id)) {
          const ids = group.map((r) => r.id);
          await this.erasure.record(tx, {
            kind: 'chat_message',
            subjectTable: 'chat.message',
            subjectIds: ids,
            schoolId,
            actor: 'system',
            reason: 'retention_purge',
            replay: plan.of(plan.del('chat.message', { id: ids })),
          });
        }
        return count;
      });
      report.chatMessages += deleted;
      if (deleted === 0) return;
    }
  }

  /**
   * Discussion replies: a deleted post nobody answered is removed; one with
   * answers stays as the "This post was deleted" placeholder that keeps the
   * thread together, but loses its author (the body is already blank).
   */
  private async purgeReplies(cutoff: Date, { opts, deadline, report }: Ctx) {
    const base = { deleted_at: { lt: cutoff }, ...this.idFilter(opts.only) };
    const leaf = { ...base, children: { none: {} } };
    const placeholder = {
      ...base,
      children: { some: {} },
      OR: [{ author_user_profile_id: { not: null } }, { body: { not: '' } }],
    };
    if (opts.dryRun) {
      report.discussionRepliesDeleted = await this.prisma.discussion_reply.count({ where: leaf });
      report.discussionRepliesScrubbed = await this.prisma.discussion_reply.count({ where: placeholder });
      return;
    }
    const select = { id: true, course: { select: { school_id: true } } };
    const school = (r: { course: { school_id: string } | null }) => r.course?.school_id ?? null;

    // Leaves first; removing one can turn its expired parent into a leaf,
    // which the next batch picks up.
    for (;;) {
      this.checkTime(deadline);
      const rows = await this.prisma.discussion_reply.findMany({ where: leaf, select, take: batchSize() });
      if (rows.length === 0) break;
      const deleted = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.discussion_reply.deleteMany({
          where: { id: { in: rows.map((r) => r.id) }, children: { none: {} } },
        });
        for (const [schoolId, group] of groupBy(rows, school)) {
          const ids = group.map((r) => r.id);
          await this.erasure.record(tx, {
            kind: 'discussion_reply',
            subjectTable: 'course.discussion_reply',
            subjectIds: ids,
            schoolId,
            actor: 'system',
            reason: 'retention_purge',
            replay: plan.of(plan.del('course.discussion_reply', { id: ids })),
          });
        }
        return count;
      });
      report.discussionRepliesDeleted += deleted;
      if (deleted === 0) break;
    }

    for (;;) {
      this.checkTime(deadline);
      const rows = await this.prisma.discussion_reply.findMany({ where: placeholder, select, take: batchSize() });
      if (rows.length === 0) return;
      const scrubbed = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.discussion_reply.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { author_user_profile_id: null, body: '' },
        });
        for (const [schoolId, group] of groupBy(rows, school)) {
          const ids = group.map((r) => r.id);
          await this.erasure.record(tx, {
            kind: 'discussion_reply',
            subjectTable: 'course.discussion_reply',
            subjectIds: ids,
            schoolId,
            actor: 'system',
            reason: 'retention_purge',
            replay: plan.of(
              plan.update('course.discussion_reply', { id: ids }, { author_user_profile_id: null, body: '' }),
            ),
          });
        }
        return count;
      });
      report.discussionRepliesScrubbed += scrubbed;
      if (scrubbed === 0) return;
    }
  }

  /**
   * Sessions that expired (sliding or absolute) or were revoked, and sign-in
   * codes, more than a day ago; remembered devices unused for 90 days. Not written to the erasure log: they are not something a person
   * asked to erase, and a restore signs everyone out anyway (BACKUPS.md).
   * SSO state and handoff codes live in the cache with a TTL.
   */
  private async purgeAuthLeftovers(now: Date, { opts, deadline, report }: Ctx) {
    const before = new Date(now.getTime() - AUTH_LEFTOVER_MS);
    const sessionWhere = {
      OR: [
        { expires_at: { lt: before } },
        { absolute_expires_at: { lt: before } },
        { revoked_at: { lt: before } },
      ],
    };
    const codeWhere = { created_at: { lt: before } };
    const deviceWhere = { last_seen_at: { lt: new Date(now.getTime() - KNOWN_DEVICE_WINDOW_MS) } };
    if (opts.dryRun) {
      report.sessions = await this.prisma.session.count({ where: sessionWhere });
      report.emailCodes = await this.prisma.email_code.count({ where: codeWhere });
      report.knownDevices = await this.prisma.known_device.count({ where: deviceWhere });
      return;
    }
    // Small rows with their own index; one statement is fine.
    report.knownDevices = (await this.prisma.known_device.deleteMany({ where: deviceWhere })).count;
    for (;;) {
      this.checkTime(deadline);
      const ids = (await this.prisma.session.findMany({ where: sessionWhere, select: { id: true }, take: batchSize() })).map((r) => r.id);
      if (ids.length === 0) break;
      const { count } = await this.prisma.session.deleteMany({ where: { id: { in: ids } } });
      report.sessions += count;
      if (count === 0) break;
    }
    for (;;) {
      this.checkTime(deadline);
      const ids = (await this.prisma.email_code.findMany({ where: codeWhere, select: { id: true }, take: batchSize() })).map((r) => r.id);
      if (ids.length === 0) break;
      const { count } = await this.prisma.email_code.deleteMany({ where: { id: { in: ids } } });
      report.emailCodes += count;
      if (count === 0) break;
    }
  }
}

type Ctx = { opts: PurgeOptions; deadline: number; report: PurgeReport };
