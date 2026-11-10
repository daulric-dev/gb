import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { FeatureService } from '@/features/feature.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { csvCell } from '@/grading/gradebook.service';
import { isOneRosterBundle, parseOneRosterCsv, parseTemplates, type CsvFile } from './roster-csv';
import { isZip, readZip } from './zip';
import { planRoster } from './roster-plan';
import { readSettings } from './roster-settings';
import { summarise, type RosterSnapshot } from './roster-types';
import { RosterStateService } from './roster-state.service';
import { RosterApplyService, type ChangeRow } from './roster-apply.service';
import { RosterSourceService, type SourceRow } from './roster-source.service';
import {
  QUEUE_ROSTER_SYNC,
  ROSTER_APPLY_BATCH,
  ROSTER_JOB_OPTS,
  ROSTER_PLAN_STALE_MS,
  ROSTER_STALE_MS,
  ROSTER_UPLOAD_MAX_BYTES,
  ROSTER_UPLOAD_PREFIX,
  type RosterJobData,
} from './rostering.constants';
import type { ListChangesQueryDto } from './dto/rostering.dto';

const ACTIVE = ['planning', 'queued', 'applying'];

const RUN_SELECT = {
  id: true,
  source_id: true,
  trigger: true,
  status: true,
  summary: true,
  error: true,
  include_disables: true,
  progress_done: true,
  progress_total: true,
  progress_failed: true,
  created_by: true,
  applied_by: true,
  created_at: true,
  planned_at: true,
  apply_started_at: true,
  finished_at: true,
} as const;
type RunRow = Prisma.roster_runGetPayload<{ select: typeof RUN_SELECT }>;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Sync runs. A dry run fetches or reads the source, plans against the
 * current state and stores the change set (nothing else is written). An
 * apply works through the stored changes in order, one transaction each,
 * with progress and a per-row error; disables are skipped unless the admin
 * confirmed them. Both run as background jobs: the `roster-sync` BullMQ
 * queue with Redis, otherwise in this process after the request answered.
 * An apply a restart interrupted is resumed by RosteringScheduler (pending
 * changes are still pending).
 */
@Injectable()
export class RosterRunService {
  private readonly logger = new Logger(RosterRunService.name);
  /** Inline mode: the job chain (tests await it). */
  inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly features: FeatureService,
    private readonly sources: RosterSourceService,
    private readonly state: RosterStateService,
    private readonly applier: RosterApplyService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() @InjectQueue(QUEUE_ROSTER_SYNC) private readonly queue?: Queue,
  ) {}

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  view(r: RunRow) {
    const summary = obj(r.summary);
    delete summary.uploads;
    return {
      id: r.id,
      sourceId: r.source_id,
      trigger: r.trigger,
      status: r.status,
      summary,
      error: r.error,
      includeDisables: r.include_disables,
      progress: { done: r.progress_done, total: r.progress_total, failed: r.progress_failed },
      createdAt: r.created_at.toISOString(),
      plannedAt: r.planned_at?.toISOString() ?? null,
      applyStartedAt: r.apply_started_at?.toISOString() ?? null,
      finishedAt: r.finished_at?.toISOString() ?? null,
    };
  }

  // --- jobs ------------------------------------------------------------------

  async enqueue(job: RosterJobData, suffix = ''): Promise<void> {
    if (this.queue) {
      await this.queue.add(job.kind, job, { ...ROSTER_JOB_OPTS, jobId: `${job.kind}-${job.runId}${suffix}` });
      return;
    }
    this.inflight = this.inflight
      .then(() => this.runJob(job))
      .catch((err) => this.logger.error(`Rostering ${job.kind} ${job.runId} failed: ${(err as Error).message}`));
  }

  async runJob(job: RosterJobData): Promise<void> {
    if (job.kind === 'plan') await this.plan(job.runId);
    else await this.applyRun(job.runId);
  }

  // --- dry run ---------------------------------------------------------------

  async startDryRun(
    sourceId: string,
    uploads: string[] | undefined,
    actorId: string | null,
    trigger: 'manual' | 'scheduled' = 'manual',
  ) {
    const source = await this.sources.require(sourceId);
    const keys = uploads ?? [];
    if (source.kind === 'csv') {
      if (keys.length === 0) throw new BadRequestException('Upload at least one CSV or ZIP file first');
      const prefix = `${ROSTER_UPLOAD_PREFIX}${sourceId}/`;
      if (keys.some((k) => !k.startsWith(prefix) || k.includes('..'))) {
        throw new BadRequestException('An upload does not belong to this source');
      }
    } else if (keys.length) {
      throw new BadRequestException('A OneRoster endpoint source reads from the endpoint, not uploads');
    }
    const active = await this.prisma.roster_run.findFirst({
      where: { source_id: sourceId, status: { in: ACTIVE } },
      select: { id: true },
    });
    if (active) throw new ConflictException('A sync of this source is already running');
    const run = await this.prisma.roster_run.create({
      data: {
        source_id: sourceId,
        trigger,
        status: 'planning',
        created_by: actorId,
        summary: { uploads: keys },
        heartbeat_at: new Date(),
      },
      select: RUN_SELECT,
    });
    await this.enqueue({ kind: 'plan', runId: run.id });
    return this.view(run);
  }

  private async readUploads(keys: string[]): Promise<RosterSnapshot> {
    const files = new Map<string, string>();
    const plain: CsvFile[] = [];
    for (const key of keys) {
      const buf = await this.storage.getBuffer(key, ROSTER_UPLOAD_MAX_BYTES);
      if (!buf) throw new Error('An uploaded file is missing; upload it again');
      if (isZip(buf)) {
        for (const [name, data] of readZip(buf)) {
          if (name.endsWith('.csv')) files.set(name, data.toString('utf8'));
        }
      } else {
        const name = key.split('/').pop()!.replace(/^[0-9a-f]{24}-/, '').toLowerCase();
        const text = buf.toString('utf8');
        files.set(name, text);
        plain.push({ name, text });
      }
    }
    if (isOneRosterBundle(files)) return parseOneRosterCsv(files);
    return parseTemplates(plain.length ? plain : [...files].map(([name, text]) => ({ name, text })));
  }

  async plan(runId: string): Promise<void> {
    const run = await this.prisma.roster_run.findUnique({ where: { id: runId }, select: RUN_SELECT });
    if (!run || run.status !== 'planning') return;
    const fail = async (message: string) => {
      await this.prisma.roster_run.update({
        where: { id: runId },
        data: { status: 'failed', error: message.slice(0, 1000), finished_at: new Date() },
      });
    };
    let source: SourceRow;
    try {
      source = await this.sources.require(run.source_id);
    } catch {
      return fail('The source was deleted');
    }
    if (!(await this.features.isEnabled(null, 'rostering'))) return fail('Rostering is turned off for the organisation');
    const uploads = (obj(run.summary).uploads as string[] | undefined) ?? [];
    let snap: RosterSnapshot;
    try {
      snap = source.kind === 'csv' ? await this.readUploads(uploads) : await this.sources.clientFor(source).snapshot();
    } catch (err) {
      await fail(`Could not read the source: ${(err as Error).message}`);
      return;
    } finally {
      if (uploads.length) await this.storage.delete(uploads).catch(() => undefined);
    }
    const settings = readSettings(source.settings);
    const state = await this.state.load(source.id, snap, settings);
    const { changes, waiting } = planRoster(snap, state, settings);

    for (let i = 0; i < changes.length; i += 500) {
      await this.prisma.roster_change.createMany({
        data: changes.slice(i, i + 500).map((c, j) => ({
          run_id: runId,
          seq: i + j,
          entity: c.entity,
          action: c.action,
          sourced_id: c.sourcedId.slice(0, 500),
          target_id: c.targetId,
          school_id: c.schoolId,
          label: c.label.slice(0, 300),
          diff: c.diff as Prisma.InputJsonObject,
          data: c.data as Prisma.InputJsonObject,
          errors: c.errors.map((e) => e.slice(0, 1000)),
          status: c.action === 'error' ? 'skipped' : 'pending',
        })),
      });
    }
    const counts = summarise(changes);
    const summary = {
      counts,
      waiting,
      total: changes.length,
      applicable: changes.filter((c) => c.action === 'create' || c.action === 'update').length,
      disables: changes.filter((c) => c.action === 'disable').length,
      errors: changes.filter((c) => c.action === 'error').length,
      source: {
        orgs: snap.orgs.length,
        sessions: snap.sessions.length,
        users: snap.users.length,
        classes: snap.classes.length,
        enrollments: snap.enrollments.length,
      },
      orgs: snap.orgs.slice(0, 500).map((o) => ({
        sourcedId: o.sourcedId,
        name: o.name,
        type: o.type,
        schoolId: o.sourcedId in settings.orgMap ? settings.orgMap[o.sourcedId] : undefined,
      })),
    };
    await this.prisma.roster_run.update({
      where: { id: runId },
      data: { status: 'planned', planned_at: new Date(), summary: summary },
    });
    this.logger.log(`Rostering dry run ${runId}: ${changes.length} change(s)`);

    // Scheduled with auto-apply: creates and updates only, never disables.
    if (run.trigger === 'scheduled' && source.auto_apply && summary.applicable > 0) {
      await this.apply(runId, { includeDisables: false }, null).catch((err) =>
        this.logger.warn(`Auto-apply of ${runId} refused: ${(err as Error).message}`),
      );
    }
  }

  // --- apply -----------------------------------------------------------------

  async apply(runId: string, opts: { includeDisables?: boolean }, actorId: string | null) {
    const run = await this.requireRun(runId);
    if (run.status !== 'planned') throw new ConflictException(`This run is ${run.status}; only a finished dry run can be applied`);
    const newer = await this.prisma.roster_run.findFirst({
      where: { source_id: run.source_id, created_at: { gt: run.created_at } },
      select: { id: true },
    });
    if (newer) throw new ConflictException('A newer dry run exists for this source; apply that one');
    const includeDisables = opts.includeDisables === true;
    const total = await this.prisma.roster_change.count({
      where: { run_id: runId, status: 'pending', ...(includeDisables ? {} : { action: { not: 'disable' } }) },
    });
    const { count } = await this.prisma.roster_run.updateMany({
      where: { id: runId, status: 'planned' },
      data: {
        status: 'queued',
        include_disables: includeDisables,
        applied_by: actorId,
        progress_total: total,
        heartbeat_at: new Date(),
      },
    });
    if (count !== 1) throw new ConflictException('This run is already being applied');
    await this.enqueue({ kind: 'apply', runId });
    return this.view(await this.requireRun(runId));
  }

  /** The apply job; also the resume path (it only touches pending changes). */
  async applyRun(runId: string): Promise<void> {
    const claimed = await this.prisma.roster_run.updateMany({
      where: { id: runId, status: { in: ['queued', 'applying'] } },
      data: { status: 'applying', heartbeat_at: new Date() },
    });
    if (claimed.count !== 1) return;
    const run = await this.requireRun(runId);
    if (!run.apply_started_at) {
      await this.prisma.roster_run.update({ where: { id: runId }, data: { apply_started_at: new Date() } });
    }
    const source = await this.prisma.roster_source.findUnique({
      where: { id: run.source_id },
      select: { id: true, settings: true, created_by: true },
    });
    if (!source) {
      await this.finish(runId, 'failed', 'The source was deleted');
      return;
    }
    const ctx = {
      sourceId: source.id,
      actorId: run.applied_by ?? source.created_by,
      settings: readSettings(source.settings),
    };
    await this.audit(run, ctx.actorId, 'started');

    if (!run.include_disables) {
      await this.prisma.roster_change.updateMany({
        where: { run_id: runId, status: 'pending', action: 'disable' },
        data: { status: 'skipped', apply_error: 'Not confirmed: disables were left out of this apply' },
      });
    }

    for (;;) {
      if (!(await this.features.isEnabled(null, 'rostering'))) {
        await this.finish(runId, 'failed', 'Rostering was turned off for the organisation; the rest was not applied');
        return;
      }
      const batch = await this.prisma.roster_change.findMany({
        where: { run_id: runId, status: 'pending' },
        orderBy: { seq: 'asc' },
        take: ROSTER_APPLY_BATCH,
        select: {
          id: true, entity: true, action: true, sourced_id: true, target_id: true, school_id: true, label: true, diff: true, data: true,
        },
      });
      if (batch.length === 0) break;
      let done = 0;
      let failed = 0;
      for (const change of batch as ChangeRow[]) {
        try {
          await this.applier.apply(change, ctx);
          done++;
        } catch (err) {
          failed++;
          await this.prisma.roster_change.update({
            where: { id: change.id },
            data: { status: 'failed', apply_error: (err as Error).message.slice(0, 1000) },
          });
        }
      }
      await this.prisma.roster_run.update({
        where: { id: runId },
        data: {
          progress_done: { increment: done },
          progress_failed: { increment: failed },
          heartbeat_at: new Date(),
        },
      });
    }
    await this.finish(runId, 'applied', null);
    await this.audit(await this.requireRun(runId), ctx.actorId, 'finished');
  }

  private async finish(runId: string, status: 'applied' | 'failed', error: string | null) {
    await this.prisma.roster_run.update({
      where: { id: runId },
      data: { status, error, finished_at: new Date(), heartbeat_at: new Date() },
    });
  }

  private async audit(run: RunRow, actorId: string | null, phase: 'started' | 'finished') {
    if (!actorId || !this.auditLog) return;
    await this.prisma.$transaction(async (tx) => {
      await this.auditLog!.record(tx, null, { id: actorId }, {
        entity: 'roster_run',
        entityId: run.id,
        action: 'update',
        changes: auditChanges(
          { status: phase === 'started' ? 'planned' : 'applying' },
          {
            status: phase === 'started' ? 'applying' : run.status,
            include_disables: run.include_disables,
            applied: run.progress_done,
            failed: run.progress_failed,
            total: run.progress_total,
          },
        ),
      });
    }).catch((err) => this.logger.warn(`Rostering audit entry failed: ${(err as Error).message}`));
  }

  async cancel(runId: string) {
    const { count } = await this.prisma.roster_run.updateMany({
      where: { id: runId, status: 'planned' },
      data: { status: 'cancelled', finished_at: new Date() },
    });
    if (count !== 1) throw new ConflictException('Only a dry run that has not been applied can be discarded');
    return this.view(await this.requireRun(runId));
  }

  // --- resume (scheduler) ----------------------------------------------------

  /** Interrupted dry runs fail; interrupted applies continue. */
  async resumeStale(now = new Date()): Promise<{ resumed: number; failed: number }> {
    const plans = await this.prisma.roster_run.updateMany({
      where: { status: 'planning', heartbeat_at: { lt: new Date(now.getTime() - ROSTER_PLAN_STALE_MS) } },
      data: { status: 'failed', error: 'The dry run was interrupted (the server restarted); start it again', finished_at: now },
    });
    const stale = await this.prisma.roster_run.findMany({
      where: {
        status: { in: ['queued', 'applying'] },
        heartbeat_at: { lt: new Date(now.getTime() - ROSTER_STALE_MS) },
      },
      select: { id: true },
      take: 20,
    });
    for (const r of stale) {
      await this.prisma.roster_run.update({ where: { id: r.id }, data: { heartbeat_at: now } });
      await this.enqueue({ kind: 'apply', runId: r.id }, `-resume-${now.getTime()}`);
    }
    return { resumed: stale.length, failed: plans.count };
  }

  // --- reading ---------------------------------------------------------------

  async requireRun(runId: string, sourceId?: string): Promise<RunRow> {
    const run = await this.prisma.roster_run.findUnique({ where: { id: runId }, select: RUN_SELECT });
    if (!run || (sourceId && run.source_id !== sourceId)) throw new NotFoundException('Sync run not found');
    return run;
  }

  async listRuns(sourceId: string) {
    await this.sources.require(sourceId);
    const rows = await this.prisma.roster_run.findMany({
      where: { source_id: sourceId },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: RUN_SELECT,
    });
    return rows.map((r) => this.view(r));
  }

  async getRun(sourceId: string, runId: string) {
    return this.view(await this.requireRun(runId, sourceId));
  }

  async changes(sourceId: string, runId: string, q: ListChangesQueryDto) {
    await this.requireRun(runId, sourceId);
    const where: Prisma.roster_changeWhereInput = {
      run_id: runId,
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { label: { contains: q.search.trim(), mode: 'insensitive' } },
              { sourced_id: { contains: q.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const limit = q.limit ?? 100;
    const [total, rows] = await Promise.all([
      this.prisma.roster_change.count({ where }),
      this.prisma.roster_change.findMany({
        where,
        orderBy: { seq: 'asc' },
        skip: q.offset ?? 0,
        take: limit,
        select: {
          id: true, seq: true, entity: true, action: true, sourced_id: true, target_id: true, school_id: true,
          label: true, diff: true, errors: true, status: true, apply_error: true, applied_at: true,
        },
      }),
    ]);
    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        entity: r.entity,
        action: r.action,
        sourcedId: r.sourced_id,
        targetId: r.target_id,
        schoolId: r.school_id,
        label: r.label,
        diff: r.diff,
        errors: r.errors,
        status: r.status,
        applyError: r.apply_error,
        appliedAt: r.applied_at?.toISOString() ?? null,
      })),
    };
  }

  /** Every row that did not apply: source errors and failed changes. */
  async errorsCsv(sourceId: string, runId: string): Promise<string> {
    await this.requireRun(runId, sourceId);
    const rows = await this.prisma.roster_change.findMany({
      where: { run_id: runId, OR: [{ action: 'error' }, { status: 'failed' }] },
      orderBy: { seq: 'asc' },
      select: { entity: true, action: true, sourced_id: true, label: true, errors: true, apply_error: true, status: true },
    });
    const lines = [['entity', 'action', 'source_id', 'record', 'status', 'error'].join(',')];
    for (const r of rows) {
      lines.push(
        [r.entity, r.action, r.sourced_id, r.label, r.status, [...r.errors, r.apply_error].filter(Boolean).join('; ')]
          .map(csvCell)
          .join(','),
      );
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}
