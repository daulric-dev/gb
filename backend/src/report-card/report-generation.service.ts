import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { FeatureService } from '@/features/feature.service';
import { ReportDataService } from './report-data.service';
import { renderReportCard } from './report-pdf';
import { reportKey } from './report-keys';
import {
  QUEUE_REPORT_CARD_GENERATE,
  REPORT_HEARTBEAT_MS,
  REPORT_JOB_ATTEMPTS,
  REPORT_JOB_OPTS,
  REPORT_RESUME_BATCH,
  REPORT_RESUME_STALE_MS,
  type ReportCardJobData,
  reportJobId,
  resumeJobId,
} from './report-card.constants';

export type GenerateOutcome = 'generated' | 'skipped';

/** A row the resume sweep found: pending, stale, in a published term. */
export interface StaleReportRow {
  id: string;
  school_id: string;
  term_id: string;
  student_id: string;
  attempts: number;
  published_at: Date;
}

export interface ResumeOutcome {
  /** Jobs run again (inline) or put back on the queue. */
  resumed: number;
  /** Rows whose attempts were used up: marked failed. */
  failed: number;
  /** Rows left alone (feature off, job still queued, held by this process). */
  skipped: number;
}

export const INTERRUPTED_ERROR =
  'Generation stopped before it finished (the server restarted). Use Retry failed to generate it again.';

const rowKey = (termId: string, studentId: string) => `${termId}:${studentId}`;

/**
 * Generates the published term reports, one job per student.
 *
 * With Redis (USE_REDIS=true and REDIS_URL) the jobs go to the BullMQ queue
 * `report-card-generate` (3 attempts, exponential backoff) and
 * ReportCardProcessor runs them. Without Redis they run in this process,
 * in the background after the publish request has answered, one student at
 * a time with the same 3 attempts. Either way the work is `generate()`.
 *
 * A job is idempotent: the PDF goes to a fixed key per school, term and
 * student (overwritten on a re-run) and the `report_document` row is
 * upserted. A job whose term was unpublished meanwhile, or whose school
 * switched report cards off, does nothing.
 *
 * Nothing is lost on a restart: each attempt records itself on the row
 * (`attempts`, `updated_at`), an inline batch keeps the rows it still holds
 * fresh (heartbeat), and `resumeStale()` (ReportGenerationScheduler, on boot
 * and every few minutes, one instance at a time) picks up pending rows of
 * published terms that nobody has touched for REPORT_RESUME_STALE_MS, with
 * the attempts they have left.
 */
@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);
  /** Inline mode: the batch still running, if any (tests await it). */
  inflight: Promise<void> = Promise.resolve();
  /** Inline mode: delay before attempt n is n x this. */
  inlineBackoffMs = 2000;
  /** Inline mode: rows (term:student) this process still has to generate. */
  private readonly held = new Map<string, { schoolId: string; termId: string; studentId: string }>();
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly data: ReportDataService,
    private readonly features: FeatureService,
    @Optional()
    @InjectQueue(QUEUE_REPORT_CARD_GENERATE)
    private readonly queue?: Queue,
  ) {}

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  /**
   * Mark every student's report as pending and queue its generation.
   * `publishedAt` makes the job ids of one publish unique (see reportJobId).
   */
  async enqueueTerm(
    schoolId: string,
    termId: string,
    publishedAt: Date,
    onlyStudentIds?: string[],
  ): Promise<{ queued: number }> {
    const term = await this.data.term(schoolId, termId);
    let studentIds = await this.data.studentIdsForTerm(term);
    if (onlyStudentIds) {
      const only = new Set(onlyStudentIds);
      studentIds = studentIds.filter((id) => only.has(id));
    }
    if (studentIds.length === 0) return { queued: 0 };

    await this.prisma.report_document.createMany({
      data: studentIds.map((student_id) => ({
        school_id: schoolId,
        term_id: termId,
        student_id,
        status: 'pending' as const,
      })),
      skipDuplicates: true,
    });
    await this.prisma.report_document.updateMany({
      where: { school_id: schoolId, term_id: termId, student_id: { in: studentIds } },
      data: { status: 'pending', error: null, attempts: 0, updated_at: new Date() },
    });

    const jobs: ReportCardJobData[] = studentIds.map((studentId) => ({ schoolId, termId, studentId }));

    if (this.queue) {
      await this.queue.addBulk(
        jobs.map((job) => ({
          name: 'generate',
          data: job,
          opts: { ...REPORT_JOB_OPTS, jobId: reportJobId(job, publishedAt) },
        })),
      );
    } else {
      this.runInlineAfterCurrent(jobs);
    }
    return { queued: jobs.length };
  }

  /** After the current batch, so two batches never interleave writes. */
  private runInlineAfterCurrent(jobs: ReportCardJobData[]) {
    for (const j of jobs) this.held.set(rowKey(j.termId, j.studentId), j);
    this.startHeartbeat();
    this.inflight = this.inflight.then(() => this.runInline(jobs));
  }

  /**
   * Inline fallback: each job with the attempts it has left (of
   * REPORT_JOB_ATTEMPTS); never throws.
   */
  private async runInline(jobs: ReportCardJobData[]): Promise<void> {
    for (const job of jobs) {
      const first = (job.attemptOffset ?? 0) + 1;
      try {
        for (let attempt = first; attempt <= REPORT_JOB_ATTEMPTS; attempt++) {
          try {
            await this.generate(job, { attempt, final: attempt === REPORT_JOB_ATTEMPTS });
            break;
          } catch (error) {
            this.logger.warn(
              `Report for student ${job.studentId} (term ${job.termId}) failed, attempt ${attempt}: ${(error as Error).message}`,
            );
            if (attempt < REPORT_JOB_ATTEMPTS && this.inlineBackoffMs > 0) {
              await new Promise((r) => setTimeout(r, this.inlineBackoffMs * attempt));
            }
          }
        }
      } finally {
        this.held.delete(rowKey(job.termId, job.studentId));
      }
    }
    if (this.held.size === 0) this.stopHeartbeat();
  }

  /**
   * Inline mode: while this process holds rows, touch their `updated_at` so
   * the resume sweep (on any instance) knows they are not abandoned.
   */
  private startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => void this.touchHeld(), REPORT_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  /** Refresh the rows this process still holds (inline mode). */
  async touchHeld(now = new Date()): Promise<void> {
    if (this.held.size === 0) {
      this.stopHeartbeat();
      return;
    }
    const byTerm = new Map<string, string[]>();
    for (const j of this.held.values()) {
      byTerm.set(j.termId, [...(byTerm.get(j.termId) ?? []), j.studentId]);
    }
    for (const [termId, studentIds] of byTerm) {
      await this.prisma.report_document
        .updateMany({
          where: { term_id: termId, student_id: { in: studentIds }, status: 'pending' },
          data: { updated_at: now },
        })
        .catch((err: Error) => this.logger.warn(`Report heartbeat failed: ${err.message}`));
    }
  }

  /** Whether this process still has the row to generate (inline mode). */
  holds(termId: string, studentId: string): boolean {
    return this.held.has(rowKey(termId, studentId));
  }

  /**
   * Pending rows of published terms nobody has touched for
   * REPORT_RESUME_STALE_MS: a restart mid-batch (inline), or a crash between
   * publish and enqueue, or a job lost from Redis (queue; only once the
   * queue has no live jobs). Run under the scheduler's advisory lock. Each
   * row is resumed with the attempts it has left; a row that used them all
   * is marked failed. Re-running is safe: the PDF key is fixed and
   * overwritten.
   */
  async resumeStale(now = new Date()): Promise<ResumeOutcome> {
    const cutoff = new Date(now.getTime() - REPORT_RESUME_STALE_MS);
    const rows = await this.prisma.$queryRaw<StaleReportRow[]>`
      SELECT d.id, d.school_id, d.term_id, d.student_id, d.attempts, r.published_at
      FROM grading.report_document d
      JOIN grading.report_release r ON r.school_id = d.school_id AND r.term_id = d.term_id
      WHERE d.status = 'pending'
        AND d.updated_at < ${cutoff}
        AND r.published_at IS NOT NULL
      ORDER BY d.updated_at ASC
      LIMIT ${REPORT_RESUME_BATCH}`;
    const out: ResumeOutcome = { resumed: 0, failed: 0, skipped: 0 };
    if (!rows?.length) return out;

    const candidates = rows.filter((r) => !this.holds(r.term_id, r.student_id));
    out.skipped += rows.length - candidates.length;
    if (candidates.length === 0) return out;
    if (this.queue && (await this.queueBusy())) {
      out.skipped += candidates.length;
      return out;
    }

    // Claim: fresh again, so the next sweep leaves them to this run.
    await this.prisma.report_document.updateMany({
      where: { id: { in: candidates.map((r) => r.id) }, status: 'pending' },
      data: { updated_at: now },
    });

    const enabled = new Map<string, boolean>();
    const toRun: ReportCardJobData[] = [];
    const exhausted: string[] = [];
    for (const row of candidates) {
      let on = enabled.get(row.school_id);
      if (on === undefined) {
        on = await this.features.isEnabled(row.school_id, 'report_cards');
        enabled.set(row.school_id, on);
      }
      if (!on) {
        out.skipped += 1;
        continue;
      }
      const job: ReportCardJobData = {
        schoolId: row.school_id,
        termId: row.term_id,
        studentId: row.student_id,
        attemptOffset: Math.max(0, row.attempts ?? 0),
      };
      if (job.attemptOffset! >= REPORT_JOB_ATTEMPTS) exhausted.push(row.id);
      else toRun.push(job);
    }

    if (exhausted.length > 0) {
      await this.prisma.report_document.updateMany({
        where: { id: { in: exhausted }, status: 'pending' },
        data: { status: 'failed', error: INTERRUPTED_ERROR, updated_at: now },
      });
      out.failed = exhausted.length;
    }
    if (toRun.length === 0) return out;

    if (this.queue) {
      await this.queue.addBulk(
        toRun.map((job) => ({
          name: 'generate',
          data: job,
          opts: {
            ...REPORT_JOB_OPTS,
            attempts: REPORT_JOB_ATTEMPTS - (job.attemptOffset ?? 0),
            jobId: resumeJobId(job, now),
          },
        })),
      );
    } else {
      this.runInlineAfterCurrent(toRun);
    }
    out.resumed = toRun.length;
    this.logger.log(`Resumed ${toRun.length} interrupted report card PDF(s)`);
    return out;
  }

  /**
   * Queue mode: whether any report job is still waiting, delayed or running.
   * Job ids differ between a publish and a regenerate, so a pending row is
   * taken as lost only once the queue has drained.
   */
  private async queueBusy(): Promise<boolean> {
    const counts = await this.queue!.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'waiting-children');
    return Object.values(counts).some((n) => n > 0);
  }

  /**
   * One student's PDF: render, store, record. Throws on failure so the queue
   * retries; the row is marked `failed` only on the last attempt.
   */
  async generate(
    job: ReportCardJobData,
    opts: { attempt?: number; final?: boolean } = {},
  ): Promise<GenerateOutcome> {
    const { schoolId, termId, studentId } = job;

    if (!(await this.features.isEnabled(schoolId, 'report_cards'))) return 'skipped';

    const release = await this.prisma.report_release.findUnique({
      where: { school_id_term_id: { school_id: schoolId, term_id: termId } },
      select: { published_at: true },
    });
    if (!release?.published_at) return 'skipped';

    const key = reportKey(schoolId, termId, studentId);
    // Record the attempt first: a restart mid-render leaves an honest count
    // for the resume sweep, and a fresh updated_at while it runs.
    await this.prisma.report_document.updateMany({
      where: { school_id: schoolId, term_id: termId, student_id: studentId, status: 'pending' },
      data: { attempts: opts.attempt ?? 1, updated_at: new Date() },
    });
    try {
      const term = await this.data.term(schoolId, termId);
      const doc = await this.data.reportCard(term, studentId, { issuedAt: release.published_at });
      const bytes = await renderReportCard(doc);
      await this.storage.put(key, Buffer.from(bytes), 'application/pdf');
      const now = new Date();
      await this.prisma.report_document.upsert({
        where: { term_id_student_id: { term_id: termId, student_id: studentId } },
        create: {
          school_id: schoolId,
          term_id: termId,
          student_id: studentId,
          status: 'ready',
          storage_key: key,
          byte_size: bytes.length,
          attempts: opts.attempt ?? 1,
          generated_at: now,
        },
        update: {
          status: 'ready',
          storage_key: key,
          byte_size: bytes.length,
          attempts: opts.attempt ?? 1,
          error: null,
          generated_at: now,
          updated_at: now,
        },
      });
      return 'generated';
    } catch (error) {
      const message = ((error as Error)?.message ?? 'Generation failed').slice(0, 1000);
      await this.prisma.report_document
        .updateMany({
          where: { school_id: schoolId, term_id: termId, student_id: studentId },
          data: {
            status: opts.final === false ? 'pending' : 'failed',
            attempts: opts.attempt ?? 1,
            error: message,
            updated_at: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
