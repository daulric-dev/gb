import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FeatureService } from '@/features/feature.service';
import { INTERRUPTED_ERROR, ReportGenerationService, type StaleReportRow } from './report-generation.service';
import { ReportGenerationScheduler } from './report-generation.scheduler';
import { ReportCardProcessor } from './report-card.processor';
import {
  REPORT_JOB_ATTEMPTS,
  REPORT_RESUME_LOCK,
  REPORT_RESUME_STALE_MS,
  resumeJobId,
} from './report-card.constants';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const OFF_SCHOOL = '99999999-9999-4999-8999-999999999999';
const TERM = '22222222-2222-4222-8222-222222222222';
const S1 = '44444444-4444-4444-8444-444444444441';
const S2 = '44444444-4444-4444-8444-444444444442';
const S3 = '44444444-4444-4444-8444-444444444443';
const NOW = new Date('2026-12-18T12:00:00Z');
const PUBLISHED = new Date('2026-12-18T10:00:00Z');

const row = (studentId: string, attempts = 0, schoolId = SCHOOL): StaleReportRow => ({
  id: `doc-${studentId.slice(-1)}-${schoolId.slice(0, 2)}`,
  school_id: schoolId,
  term_id: TERM,
  student_id: studentId,
  attempts,
  published_at: PUBLISHED,
});

function build(opts: { queue?: Record<string, unknown> } = {}) {
  const prisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: {} });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) => ({
    disabled_features: where.id === OFF_SCHOOL ? ['report_cards'] : [],
  }));
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const generation = new ReportGenerationService(
    prisma as any,
    {} as any,
    {} as any,
    features,
    opts.queue as any,
  );
  generation.inlineBackoffMs = 0;
  const calls: Array<{ studentId: string; attempt?: number; final?: boolean }> = [];
  const generate = mock(async (job: any, o: any = {}) => {
    calls.push({ studentId: job.studentId, attempt: o.attempt, final: o.final });
    return 'generated' as const;
  });
  generation.generate = generate as any;
  return { prisma, generation, generate, calls };
}

function staleRows(prisma: MockPrisma, rows: StaleReportRow[]) {
  prisma.$queryRaw.mockResolvedValue(rows);
}

describe('resuming interrupted report generation (inline mode)', () => {
  test('selects only stale pending rows of published terms', async () => {
    const { prisma, generation } = build();
    await generation.resumeStale(NOW);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain("d.status = 'pending'");
    expect(sql).toContain('d.updated_at < ?');
    expect(sql).toContain('JOIN grading.report_release r');
    expect(sql).toContain('r.published_at IS NOT NULL');
    expect(values[0]).toEqual(new Date(NOW.getTime() - REPORT_RESUME_STALE_MS));
  });

  test('re-runs each row with the attempts it has left, after claiming it', async () => {
    const { prisma, generation, calls } = build();
    staleRows(prisma, [row(S1, 0), row(S2, 1)]);
    const out = await generation.resumeStale(NOW);
    await generation.inflight;

    expect(out).toEqual({ resumed: 2, failed: 0, skipped: 0 });
    const claim = prisma.report_document.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ status: 'pending', id: { in: [row(S1).id, row(S2).id] } });
    expect(claim.data).toEqual({ updated_at: NOW });
    expect(calls).toEqual([
      { studentId: S1, attempt: 1, final: false },
      { studentId: S2, attempt: 2, final: false },
    ]);
  });

  test('a failing resumed job stops at the attempt limit', async () => {
    const { prisma, generation, generate, calls } = build();
    generate.mockImplementation(async (job: any, o: any) => {
      calls.push({ studentId: job.studentId, attempt: o.attempt, final: o.final });
      throw new Error('still broken');
    });
    staleRows(prisma, [row(S1, 1)]);
    await generation.resumeStale(NOW);
    await generation.inflight;
    expect(calls.map((c) => c.attempt)).toEqual([2, 3]);
    expect(calls.at(-1)!.final).toBe(true);
  });

  test('a row with no attempts left is marked failed, not run', async () => {
    const { prisma, generation, calls } = build();
    staleRows(prisma, [row(S1, REPORT_JOB_ATTEMPTS)]);
    const out = await generation.resumeStale(NOW);
    await generation.inflight;
    expect(out).toEqual({ resumed: 0, failed: 1, skipped: 0 });
    expect(calls).toEqual([]);
    const failed = prisma.report_document.updateMany.mock.calls[1][0];
    expect(failed.where).toMatchObject({ id: { in: [row(S1).id] }, status: 'pending' });
    expect(failed.data).toMatchObject({ status: 'failed', error: INTERRUPTED_ERROR });
  });

  test('a school with report cards switched off is left alone', async () => {
    const { prisma, generation, calls } = build();
    staleRows(prisma, [row(S1, 0, OFF_SCHOOL), row(S2, 0)]);
    const out = await generation.resumeStale(NOW);
    await generation.inflight;
    expect(out).toEqual({ resumed: 1, failed: 0, skipped: 1 });
    expect(calls.map((c) => c.studentId)).toEqual([S2]);
  });

  test('rows this process still holds are not taken twice; the heartbeat keeps them fresh', async () => {
    const { prisma, generation, generate } = build();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    generate.mockImplementation(async () => {
      await gate;
      return 'generated';
    });
    staleRows(prisma, [row(S1), row(S2)]);
    await generation.resumeStale(NOW);
    expect(generation.holds(TERM, S1)).toBe(true);

    // The same rows again (another sweep before the batch finished): skipped.
    const again = await generation.resumeStale(NOW);
    expect(again).toEqual({ resumed: 0, failed: 0, skipped: 2 });

    prisma.report_document.updateMany.mockClear();
    const beat = new Date(NOW.getTime() + 60_000);
    await generation.touchHeld(beat);
    const touch = prisma.report_document.updateMany.mock.calls[0][0];
    expect(touch.where).toEqual({ term_id: TERM, student_id: { in: [S1, S2] }, status: 'pending' });
    expect(touch.data).toEqual({ updated_at: beat });

    release();
    await generation.inflight;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generation.holds(TERM, S1)).toBe(false);
  });

  test('nothing stale: no claim, nothing run', async () => {
    const { prisma, generation, generate } = build();
    const out = await generation.resumeStale(NOW);
    expect(out).toEqual({ resumed: 0, failed: 0, skipped: 0 });
    expect(prisma.report_document.updateMany).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('resuming with the BullMQ queue', () => {
  const idle = () => ({
    addBulk: mock(async () => []),
    getJobCounts: mock(async () => ({ waiting: 0, active: 0, delayed: 0, prioritized: 0, 'waiting-children': 0 })),
  });

  test('a job lost before enqueue (crash after publish) is put back once the queue has drained', async () => {
    const queue = idle();
    const { prisma, generation, generate } = build({ queue });
    staleRows(prisma, [row(S1, 0), row(S3, 2)]);
    const out = await generation.resumeStale(NOW);
    expect(out.resumed).toBe(2);
    expect(generate).not.toHaveBeenCalled();
    const jobs = (queue.addBulk.mock.calls[0] as any)[0];
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      name: 'generate',
      data: { schoolId: SCHOOL, termId: TERM, studentId: S1, attemptOffset: 0 },
      opts: { attempts: 3, jobId: resumeJobId({ schoolId: SCHOOL, termId: TERM, studentId: S1 }, NOW) },
    });
    // Only the attempts left.
    expect(jobs[1].opts.attempts).toBe(1);
    expect(jobs[1].data.attemptOffset).toBe(2);
  });

  test('while report jobs are still queued or running, pending rows are left to them', async () => {
    const queue = idle();
    queue.getJobCounts.mockImplementation(async () => ({ waiting: 4, active: 1, delayed: 0, prioritized: 0, 'waiting-children': 0 }));
    const { prisma, generation } = build({ queue });
    staleRows(prisma, [row(S1)]);
    const out = await generation.resumeStale(NOW);
    expect(out).toEqual({ resumed: 0, failed: 0, skipped: 1 });
    expect(queue.addBulk).not.toHaveBeenCalled();
    expect(prisma.report_document.updateMany).not.toHaveBeenCalled();
  });

  test('the worker numbers attempts after the ones already made', async () => {
    const generation = { generate: mock(async () => 'generated') };
    const processor = new ReportCardProcessor(generation as any);
    const data = { schoolId: SCHOOL, termId: TERM, studentId: S1, attemptOffset: 2 };
    await processor.process({ data, attemptsMade: 0, opts: { attempts: 1 } } as any);
    expect((generation.generate.mock.calls[0] as any)[1]).toEqual({ attempt: 3, final: true });
    await processor.process({ data: { ...data, attemptOffset: undefined }, attemptsMade: 1, opts: { attempts: 3 } } as any);
    expect((generation.generate.mock.calls[1] as any)[1]).toEqual({ attempt: 2, final: false });
  });
});

describe('ReportGenerationScheduler', () => {
  let savedEnv: string | undefined;
  let savedSweep: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.NODE_ENV;
    savedSweep = process.env.REPORT_GENERATION_SWEEP;
  });
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
    if (savedSweep === undefined) delete process.env.REPORT_GENERATION_SWEEP;
    else process.env.REPORT_GENERATION_SWEEP = savedSweep;
  });

  function setup(locked: boolean) {
    const prisma = createMockPrisma();
    prisma.$queryRaw.mockResolvedValue([{ locked }]);
    const generation = { resumeStale: mock(async () => ({ resumed: 0, failed: 0, skipped: 0 })) };
    return { prisma, generation, scheduler: new ReportGenerationScheduler(prisma as any, generation as any) };
  }

  test('sweeps under the advisory lock', async () => {
    const { prisma, generation, scheduler } = setup(true);
    await scheduler.tick(NOW);
    expect((prisma.$queryRaw.mock.calls[0] as unknown[])[1]).toBe(REPORT_RESUME_LOCK);
    expect(generation.resumeStale).toHaveBeenCalledWith(NOW);
  });

  test('another instance holding the lock: nothing runs here', async () => {
    const { generation, scheduler } = setup(false);
    await scheduler.tick(NOW);
    expect(generation.resumeStale).not.toHaveBeenCalled();
  });

  test('a failing sweep is logged, never thrown', async () => {
    const { generation, scheduler } = setup(true);
    generation.resumeStale.mockImplementation(async () => {
      throw new Error('db down');
    });
    await scheduler.tick(NOW);
  });

  test('runs once on boot (not under tests, not when switched off)', async () => {
    const { generation, scheduler } = setup(true);
    scheduler.onApplicationBootstrap();
    expect(generation.resumeStale).not.toHaveBeenCalled();

    process.env.NODE_ENV = 'production';
    process.env.REPORT_GENERATION_SWEEP = 'false';
    scheduler.onApplicationBootstrap();
    expect(generation.resumeStale).not.toHaveBeenCalled();

    delete process.env.REPORT_GENERATION_SWEEP;
    scheduler.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 0));
    expect(generation.resumeStale).toHaveBeenCalledTimes(1);
    scheduler.onModuleDestroy();
  });
});
