import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { StorageService } from '@/storage/storage.service';
import { FeatureService } from '@/features/feature.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { MailService } from '@/mail/mail.service';
import { MessageCipher } from '@/chat/message-cipher.service';
import { primaryOrigin } from '@/config/origins';
import { isUniqueViolation } from '@/common/db-values';
import { resolveParent, resolveSelf, resolveStaff } from './data-export-access';
import { collectorsFor } from './registry';
import { buildArchive } from './archive';
import { buildReadme, type ReadmeCategory } from './readme';
import { fullName } from './collectors/helpers';
import {
  ACTIVE_STATUSES,
  DOWNLOAD_URL_TTL_SECONDS,
  EXPIRED_ROW_DAYS,
  EXPORT_JOB_ATTEMPTS,
  EXPORT_JOB_OPTS,
  EXPORT_PREFIX,
  QUEUE_DATA_EXPORT,
  STALE_MS,
  exportKey,
  exportTtlHours,
  maxObjectBytes,
  maxTotalObjectBytes,
} from './data-export.constants';
import { KIND_OF_SCOPE, type Collector, type ExportObject, type ExportScope, type ExportSubject } from './data-export.types';

type Row = Prisma.data_exportGetPayload<object>;
type Kind = 'self' | 'student' | 'child';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SCOPE_OF_KIND: Record<Kind, ExportScope> = { self: 'self', student: 'staff', child: 'parent' };

/** The parent_settings switch -> what README.txt calls the hidden category. */
const PARENT_HIDDEN_LABEL: Record<string, string> = {
  showGrades: 'grades and marks',
  showWork: 'the work list',
  showAttendance: 'attendance',
  showReports: 'report cards',
  showMastery: 'learning outcomes (mastery)',
};

export interface ExportView {
  id: string;
  kind: Kind;
  status: string;
  studentId: string | null;
  studentName: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  byteSize: number | null;
  categories: Record<string, number>;
  filesIncluded: number;
  filesSkipped: number;
  /** Staff exports: pastoral notes withheld under an exemption. */
  withheldNotes?: number;
  /** Staff exports: the exporter could see every pastoral note (read + safeguarding). */
  pastoralComplete?: boolean;
  error: string | null;
}

/**
 * Subject access and data portability exports (GDPR Art 15 and 20).
 *
 * A request creates a `compliance.data_export` row and queues a job; the job
 * resolves access again, runs the collectors for the export's scope (see
 * registry.ts), writes a ZIP to object storage and marks the row ready for
 * DATA_EXPORT_TTL_HOURS. Only the person who asked can download it, through
 * a 5-minute signed URL; the sweep (DataExportScheduler) deletes expired
 * ZIPs. With Redis the jobs run on the `data-export` BullMQ queue (3
 * attempts); without it in this process, one at a time, after the request
 * has answered.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);
  /** Inline mode: the chain of jobs still running (tests await it). */
  inflight: Promise<void> = Promise.resolve();
  /** Inline mode: delay before attempt n is n x this. */
  inlineBackoffMs = 5000;
  /** Inline mode: ids this process holds, so the resume sweep leaves them alone. */
  private readonly held = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly features: FeatureService,
    private readonly audit: AuditLogService,
    private readonly mail: MailService,
    private readonly cipher: MessageCipher,
    @Optional()
    @InjectQueue(QUEUE_DATA_EXPORT)
    private readonly queue?: Queue,
  ) {}

  // ---- requests -------------------------------------------------------

  async requestSelf(userId: string): Promise<ExportView> {
    const subject = await resolveSelf(this.prisma, userId);
    return this.create(userId, subject);
  }

  async requestStudent(userId: string, studentId: string): Promise<ExportView> {
    const subject = await resolveStaff(this.prisma, this.cache, this.features, userId, studentId);
    return this.create(userId, subject);
  }

  async requestChild(userId: string, studentId: string): Promise<ExportView> {
    const subject = await resolveParent(this.prisma, this.features, userId, studentId);
    return this.create(userId, subject);
  }

  private async create(requester: string, subject: ExportSubject): Promise<ExportView> {
    const kind = KIND_OF_SCOPE[subject.scope];
    const studentId = kind === 'self' ? null : subject.studentIds[0];
    const subjectUserId = kind === 'self' ? subject.userId : null;
    const active = await this.prisma.data_export.findFirst({
      where: {
        requested_by: requester,
        kind,
        ...(studentId ? { student_id: studentId } : { subject_user_id: subjectUserId }),
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
    if (active) return (await this.views([active]))[0];

    // Self exports are recorded against the person's active school, so the
    // school's audit log shows them; staff and parent ones against the
    // student's school.
    const auditSchool =
      subject.schoolId ??
      (await this.prisma.user_profile.findUnique({ where: { id: requester }, select: { school_id: true } }))?.school_id ??
      null;
    let row: Row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.data_export.create({
          data: {
            requested_by: requester,
            kind,
            subject_user_id: subjectUserId,
            student_id: studentId,
            school_id: kind === 'self' ? null : subject.schoolId,
          },
        });
        await this.audit.record(tx, auditSchool, { id: requester }, {
          entity: 'data_export',
          entityId: created.id,
          action: 'create',
          changes: auditChanges(null, { kind, student_id: studentId, subject_user_id: subjectUserId }),
        });
        return created;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A second click raced the first: answer with the export it made.
      const again = await this.prisma.data_export.findFirst({
        where: {
          requested_by: requester,
          kind,
          ...(studentId ? { student_id: studentId } : { subject_user_id: subjectUserId }),
          status: { in: [...ACTIVE_STATUSES] },
        },
      });
      if (!again) throw err;
      return (await this.views([again]))[0];
    }
    await this.enqueue(row.id);
    return (await this.views([row]))[0];
  }

  // ---- reading ---------------------------------------------------------

  /** The caller's own exports, newest first (optionally about one student). */
  async list(userId: string, studentId?: string): Promise<ExportView[]> {
    const rows = await this.prisma.data_export.findMany({
      where: { requested_by: userId, ...(studentId ? { student_id: studentId } : {}) },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return this.views(rows);
  }

  async get(userId: string, id: string): Promise<ExportView> {
    return (await this.views([await this.own(userId, id)]))[0];
  }

  /**
   * A short-lived signed URL for the ZIP. Only the person who asked for the
   * export, while it has not expired; each download is audited.
   */
  async download(userId: string, id: string, now = new Date()) {
    const row = await this.own(userId, id);
    if (row.status !== 'ready' || !row.storage_key || !row.expires_at || row.expires_at <= now) {
      throw new BadRequestException('This export is not ready, or has expired');
    }
    const filename = `gradebook-data-${row.kind}-${(row.completed_at ?? now).toISOString().slice(0, 10)}.zip`;
    const url = await this.storage.downloadUrl(row.storage_key, {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      filename,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.data_export.update({ where: { id: row.id }, data: { downloaded_at: now } });
      await this.audit.record(tx, row.school_id, { id: userId }, {
        entity: 'data_export',
        entityId: row.id,
        action: 'read',
        changes: {},
      });
    });
    return { url, filename, urlExpiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  /** Delete an export early (the ZIP and the row). */
  async remove(userId: string, id: string): Promise<void> {
    const row = await this.own(userId, id);
    if (row.storage_key) await this.storage.delete(row.storage_key);
    await this.prisma.$transaction(async (tx) => {
      await tx.data_export.delete({ where: { id: row.id } });
      await this.audit.record(tx, row.school_id, { id: userId }, {
        entity: 'data_export',
        entityId: row.id,
        action: 'delete',
        changes: auditChanges({ status: row.status }, { status: 'deleted' }),
      });
    });
  }

  private async own(userId: string, id: string): Promise<Row> {
    const row = await this.prisma.data_export.findFirst({ where: { id, requested_by: userId } });
    if (!row) throw new NotFoundException('Export not found');
    return row;
  }

  private async views(rows: Row[]): Promise<ExportView[]> {
    const studentIds = [...new Set(rows.map((r) => r.student_id).filter((x): x is string => !!x))];
    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
    const names = new Map(students.map((s) => [s.id, fullName(s)]));
    return rows.map((r) => {
      const m = (r.manifest ?? {}) as Record<string, unknown>;
      const view: ExportView = {
        id: r.id,
        kind: r.kind as Kind,
        status: r.status,
        studentId: r.student_id,
        studentName: r.student_id ? (names.get(r.student_id) ?? null) : null,
        createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at?.toISOString() ?? null,
        expiresAt: r.expires_at?.toISOString() ?? null,
        downloadedAt: r.downloaded_at?.toISOString() ?? null,
        byteSize: r.byte_size != null ? Number(r.byte_size) : null,
        categories: (m.categories as Record<string, number>) ?? {},
        filesIncluded: Number(m.filesIncluded ?? 0),
        filesSkipped: Number(m.filesSkipped ?? 0),
        error: r.status === 'failed' ? (r.error ?? 'The export failed') : null,
      };
      if (r.kind === 'student') {
        view.withheldNotes = Number(m.withheldNotes ?? 0);
        view.pastoralComplete = m.pastoralComplete === true;
      }
      return view;
    });
  }

  // ---- the job ------------------------------------------------------------

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  private async enqueue(exportId: string) {
    if (this.queue) {
      await this.queue.add('build', { exportId }, { ...EXPORT_JOB_OPTS, jobId: exportId });
      return;
    }
    this.held.add(exportId);
    this.inflight = this.inflight.then(() => this.runInline(exportId));
  }

  /** Inline mode: the job with its retries; never throws. */
  private async runInline(exportId: string): Promise<void> {
    try {
      for (let attempt = 1; attempt <= EXPORT_JOB_ATTEMPTS; attempt++) {
        try {
          await this.run(exportId, { final: attempt === EXPORT_JOB_ATTEMPTS });
          return;
        } catch (err) {
          this.logger.warn(`Data export ${exportId} attempt ${attempt} failed: ${(err as Error).message}`);
          if (attempt < EXPORT_JOB_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * this.inlineBackoffMs));
        }
      }
    } finally {
      this.held.delete(exportId);
    }
  }

  /** Rebuild the subject from the row, checking access again. */
  private async subjectOf(row: Row): Promise<ExportSubject> {
    switch (row.kind as Kind) {
      case 'self':
        return resolveSelf(this.prisma, row.subject_user_id ?? row.requested_by);
      case 'student':
        return resolveStaff(this.prisma, this.cache, this.features, row.requested_by, row.student_id!);
      case 'child':
        return resolveParent(this.prisma, this.features, row.requested_by, row.student_id!);
    }
  }

  /** The collectors an export runs: the scope's, minus what parents are not shown. */
  static collectorsFor(subject: ExportSubject): { run: Collector[]; hidden: string[] } {
    const all = collectorsFor(subject.scope);
    if (subject.scope !== 'parent' || !subject.parentSettings) return { run: all, hidden: [] };
    const s = subject.parentSettings;
    const hidden = Object.entries(PARENT_HIDDEN_LABEL)
      .filter(([key]) => !s[key as keyof typeof s])
      .map(([, label]) => label);
    return { run: all.filter((c) => !c.parentSetting || s[c.parentSetting]), hidden };
  }

  /**
   * Build one export. Throws to have the caller retry; on the final attempt
   * the row is marked failed instead. Idempotent: the ZIP goes to a fixed key.
   */
  async run(exportId: string, opts: { final: boolean }, now = new Date()): Promise<'ready' | 'skipped' | 'failed'> {
    const row = await this.prisma.data_export.findUnique({ where: { id: exportId } });
    if (!row || !(ACTIVE_STATUSES as readonly string[]).includes(row.status)) return 'skipped';
    await this.prisma.data_export.update({
      where: { id: row.id },
      data: { status: 'running', attempts: { increment: 1 }, started_at: row.started_at ?? now, updated_at: now },
    });

    let subject: ExportSubject;
    try {
      subject = await this.subjectOf(row);
    } catch (err) {
      // Access was removed after the request: never retried.
      await this.fail(row.id, `Access check failed: ${(err as Error).message}`);
      return 'failed';
    }

    try {
      const { run: collectors, hidden } = DataExportService.collectorsFor(subject);
      const ctx = { prisma: this.prisma, cipher: this.cipher, subject, now };
      const json: Record<string, unknown> = {};
      const categories: ReadmeCategory[] = [];
      const objects: ExportObject[] = [];
      const internal: Record<string, number> = {};
      for (const c of collectors) {
        const result = await c.collect(ctx);
        json[c.id] = result.data;
        categories.push({ id: c.id, title: c.title, description: c.description, count: result.count });
        objects.push(...(result.objects ?? []));
        Object.assign(internal, result.internal ?? {});
        // Heartbeat: a long build is not mistaken for a stalled one.
        await this.prisma.data_export.update({ where: { id: row.id }, data: { updated_at: new Date() } });
      }
      const names = await this.names(subject);
      const ttl = exportTtlHours();
      const built = await buildArchive({
        json,
        objects,
        storage: this.storage,
        limits: { maxObjectBytes: maxObjectBytes(), maxTotalObjectBytes: maxTotalObjectBytes() },
        readme: (skipped, included) =>
          buildReadme({
            scope: subject.scope,
            preparedAt: now,
            subjectName: names.subject,
            schoolName: names.school,
            categories,
            hiddenFromParents: hidden,
            objectsIncluded: included,
            skipped,
            keptHours: ttl,
          }),
      });
      const key = exportKey(row.id);
      await this.storage.put(key, built.zip, 'application/zip');
      const done = new Date();
      const manifest: Record<string, unknown> = {
        categories: Object.fromEntries(categories.map((c) => [c.id, c.count])),
        filesIncluded: built.objectsIncluded,
        filesSkipped: built.skipped.length,
      };
      if (subject.scope === 'staff') {
        manifest.withheldNotes = internal.withheld ?? 0;
        manifest.pastoralComplete = internal.complete === 1;
      }
      const updated = await this.prisma.data_export.updateMany({
        where: { id: row.id, status: 'running' },
        data: {
          status: 'ready',
          storage_key: key,
          byte_size: BigInt(built.zip.length),
          manifest: manifest as Prisma.InputJsonValue,
          error: null,
          completed_at: done,
          expires_at: new Date(done.getTime() + ttl * HOUR_MS),
          updated_at: done,
        },
      });
      if (updated.count === 0) {
        // Deleted while it was being built: do not leave the ZIP behind.
        await this.storage.delete(key).catch(() => undefined);
        return 'skipped';
      }
      await this.notify(row, ttl, done);
      return 'ready';
    } catch (err) {
      this.logger.error(`Data export ${row.id} failed: ${(err as Error).message}`);
      if (opts.final) {
        await this.fail(row.id, 'The export could not be built. Try again later.');
        return 'failed';
      }
      await this.prisma.data_export
        .update({ where: { id: row.id }, data: { status: 'pending', updated_at: new Date() } })
        .catch(() => undefined);
      throw err;
    }
  }

  private async fail(id: string, error: string) {
    await this.prisma.data_export
      .updateMany({ where: { id }, data: { status: 'failed', error: error.slice(0, 500), updated_at: new Date() } })
      .catch(() => undefined);
  }

  private async names(subject: ExportSubject): Promise<{ subject: string | null; school: string | null }> {
    const [profile, student, school] = await Promise.all([
      subject.userId
        ? this.prisma.user_profile.findUnique({ where: { id: subject.userId }, select: { first_name: true, last_name: true } })
        : null,
      subject.studentIds[0]
        ? this.prisma.student.findUnique({ where: { id: subject.studentIds[0] }, select: { first_name: true, last_name: true } })
        : null,
      subject.schoolId ? this.prisma.school.findUnique({ where: { id: subject.schoolId }, select: { name: true } }) : null,
    ]);
    return { subject: fullName(student) ?? fullName(profile), school: school?.name ?? null };
  }

  /** Email the requester that it is ready, when mail is set up. Never throws. */
  private async notify(row: Row, ttlHours: number, readyAt: Date) {
    if (!this.mail.configured()) return;
    try {
      const requester = await this.prisma.user_profile.findUnique({
        where: { id: row.requested_by },
        select: { email: true, account_type: true, app_user: { select: { email: true } } },
      });
      const to = requester?.app_user?.email ?? requester?.email;
      if (!to) return;
      const path =
        row.kind === 'student'
          ? `/dashboard/students/${row.student_id}`
          : requester?.account_type === 'parent'
            ? '/parent/settings'
            : requester?.account_type === 'student'
              ? '/portal/settings'
              : '/dashboard/settings';
      const until = new Date(readyAt.getTime() + ttlHours * HOUR_MS).toISOString().replace('T', ' ').slice(0, 16);
      // No names in the subject or body: mail subjects end up in logs.
      await this.mail.send({
        to,
        subject: 'Your GradeBook data export is ready',
        text: [
          'The data export you asked for is ready.',
          '',
          `Sign in and open ${primaryOrigin()}${path} to download it. You will be asked to confirm it's you.`,
          '',
          `It can be downloaded until ${until} UTC; after that it is deleted.`,
          '',
          'If you did not ask for this, sign in and check your account, or contact your school.',
        ].join('\n'),
      });
    } catch (err) {
      this.logger.warn(`Data export ready email failed: ${(err as Error).message}`);
    }
  }

  // ---- the sweep --------------------------------------------------------

  /**
   * Delete expired ZIPs (and rows expired for EXPIRED_ROW_DAYS, failed rows
   * after 7 days), remove ZIPs no row points at, and resume exports a
   * restart left behind. Run by DataExportScheduler under an advisory lock.
   */
  async sweep(now = new Date()) {
    const expired = await this.prisma.data_export.findMany({
      where: { status: 'ready', expires_at: { lte: now } },
      select: { id: true, storage_key: true },
      take: 500,
    });
    const keys = expired.map((e) => e.storage_key).filter((k): k is string => !!k);
    if (keys.length) await this.storage.delete(keys);
    if (expired.length) {
      await this.prisma.data_export.updateMany({
        where: { id: { in: expired.map((e) => e.id) } },
        data: { status: 'expired', storage_key: null, updated_at: now },
      });
    }
    const dropped = await this.prisma.data_export.deleteMany({
      where: {
        OR: [
          { status: 'expired', updated_at: { lt: new Date(now.getTime() - EXPIRED_ROW_DAYS * DAY_MS) } },
          { status: 'failed', updated_at: { lt: new Date(now.getTime() - 7 * DAY_MS) } },
        ],
      },
    });

    // ZIPs older than the longest lifetime that no ready row points at
    // (a crash between the upload and the row update, a deleted row).
    const old = await this.storage.listKeysOlderThan(EXPORT_PREFIX, new Date(now.getTime() - (exportTtlHours() + 1) * HOUR_MS));
    let orphans = 0;
    if (old.length) {
      const live = await this.prisma.data_export.findMany({
        where: { storage_key: { in: old }, status: 'ready', expires_at: { gt: now } },
        select: { storage_key: true },
      });
      const keep = new Set(live.map((l) => l.storage_key));
      const gone = old.filter((k) => !keep.has(k));
      if (gone.length) await this.storage.delete(gone);
      orphans = gone.length;
    }

    const resumed = await this.resumeStale(now);
    return { expired: expired.length, deleted: dropped.count, orphans, ...resumed };
  }

  private async resumeStale(now: Date) {
    const stale = await this.prisma.data_export.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] }, updated_at: { lt: new Date(now.getTime() - STALE_MS) } },
      select: { id: true, attempts: true },
      take: 100,
    });
    let resumed = 0;
    let failed = 0;
    for (const s of stale) {
      if (this.held.has(s.id)) continue;
      if (s.attempts >= EXPORT_JOB_ATTEMPTS) {
        await this.fail(s.id, 'The export stopped before it finished. Ask for a new one.');
        failed += 1;
        continue;
      }
      await this.prisma.data_export.update({ where: { id: s.id }, data: { status: 'pending', updated_at: now } });
      if (this.queue) {
        // A fresh job id: the old one may still sit in the completed/failed set.
        await this.queue.add('build', { exportId: s.id }, { ...EXPORT_JOB_OPTS, jobId: `${s.id}:${now.getTime()}` });
      } else {
        this.held.add(s.id);
        this.inflight = this.inflight.then(() => this.runInline(s.id));
      }
      resumed += 1;
    }
    return { resumed, failed };
  }
}
