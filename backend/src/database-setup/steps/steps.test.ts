import { describe, expect, test } from 'bun:test';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { runSetupSteps, type SetupStep } from './runner';
import { SETUP_STEPS, analyticsDefaultOffKeepExisting, studentLeftAtBackfill } from './steps';

const NOW = new Date('2026-11-14T12:00:00Z');

/** A mock whose setup_step table behaves like a table (rolled back with a failed transaction). */
function ledgerDb(): MockPrisma & { rows: Map<string, { key: string; summary: string | null }> } {
  const prisma = createMockPrisma() as MockPrisma & { rows: Map<string, { key: string; summary: string | null }> };
  const rows = new Map<string, { key: string; summary: string | null }>();
  prisma.rows = rows;
  prisma.setup_step.findUnique.mockImplementation(async ({ where }: any) => rows.get(where.key) ?? null);
  prisma.setup_step.create.mockImplementation(async ({ data }: any) => {
    if (rows.has(data.key)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    }
    rows.set(data.key, { key: data.key, summary: null });
    return rows.get(data.key);
  });
  prisma.setup_step.update.mockImplementation(async ({ where, data }: any) => {
    rows.get(where.key)!.summary = data.summary;
    return rows.get(where.key);
  });
  prisma.$transaction.mockImplementation(async (fn: any) => {
    const before = new Map([...rows].map(([k, v]) => [k, { ...v }]));
    try {
      return await fn(prisma);
    } catch (err) {
      rows.clear();
      for (const [k, v] of before) rows.set(k, v);
      throw err;
    }
  });
  return prisma;
}

const step = (key: string, run: SetupStep['run']): SetupStep => ({ key, description: key, run });

describe('setup step runner', () => {
  test('runs each step once; a second run only reports them', async () => {
    const db = ledgerDb();
    let calls = 0;
    const steps = [step('one', async () => `ran ${++calls}`)];
    expect(await runSetupSteps(db as any, steps, NOW)).toEqual([{ key: 'one', outcome: 'applied', summary: 'ran 1' }]);
    expect(await runSetupSteps(db as any, steps, NOW)).toEqual([{ key: 'one', outcome: 'already-applied', summary: 'ran 1' }]);
    expect(calls).toBe(1);
    // Ledger row first, in the same transaction as the work.
    expect(db.setup_step.create.mock.calls[0][0].data).toEqual({ key: 'one', applied_at: NOW });
  });

  test('a failed step is not recorded and is retried next time; later steps still run', async () => {
    const db = ledgerDb();
    let fail = true;
    const steps = [
      step('flaky', async () => {
        if (fail) throw new Error('nope');
        return 'ok';
      }),
      step('next', async () => 'fine'),
    ];
    const first = await runSetupSteps(db as any, steps, NOW);
    expect(first.map((r) => r.outcome)).toEqual(['failed', 'applied']);
    expect(db.rows.has('flaky')).toBe(false);
    fail = false;
    const second = await runSetupSteps(db as any, steps, NOW);
    expect(second.map((r) => r.outcome)).toEqual(['applied', 'already-applied']);
  });

  test('another runner claiming the step first (unique violation) counts as already applied', async () => {
    const db = ledgerDb();
    db.setup_step.findUnique.mockResolvedValue(null);
    db.rows.set('one', { key: 'one', summary: null });
    let ran = false;
    const [r] = await runSetupSteps(db as any, [step('one', async () => ((ran = true), 'x'))], NOW);
    expect(r.outcome).toBe('already-applied');
    expect(ran).toBe(false);
  });

  test('duplicate keys are a programming error', async () => {
    await expect(runSetupSteps(ledgerDb() as any, [step('a', async () => ''), step('a', async () => '')])).rejects.toThrow('Duplicate');
  });

  test('the shipped steps have unique, stable keys', () => {
    expect(SETUP_STEPS.map((s) => s.key)).toEqual(['student-left-at-backfill', 'analytics-default-off-keep-existing']);
  });
});

describe('analytics-default-off-keep-existing', () => {
  test('a fresh database with no organisation: no-op', async () => {
    const db = createMockPrisma();
    expect(await analyticsDefaultOffKeepExisting.run(db as any, NOW)).toBe('0 of 0 organisation(s) given an explicit analytics: true');
    expect(db.organisation.update).not.toHaveBeenCalled();
  });

  test('an existing organisation without a choice keeps analytics on; an explicit choice is kept', async () => {
    const db = createMockPrisma();
    db.organisation.findMany.mockResolvedValue([
      { id: 'o1', features: { ai_assistance: true } },
      { id: 'o2', features: { analytics: false } },
      { id: 'o3', features: { analytics: true } },
      { id: 'o4', features: null },
      { id: 'o5', features: { analytics: 'yes' } },
    ]);
    const summary = await analyticsDefaultOffKeepExisting.run(db as any, NOW);
    expect(summary).toBe('3 of 5 organisation(s) given an explicit analytics: true');
    const updates = db.organisation.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.features]);
    expect(updates).toEqual([
      ['o1', { ai_assistance: true, analytics: true }],
      ['o4', { analytics: true }],
      ['o5', { analytics: true }],
    ]);
  });

  test('through the runner: once only, so organisations created later start with the new default (off)', async () => {
    const db = ledgerDb();
    db.organisation.findMany.mockResolvedValue([{ id: 'o1', features: {} }]);
    await runSetupSteps(db as any, [analyticsDefaultOffKeepExisting], NOW);
    db.organisation.findMany.mockResolvedValue([{ id: 'o1', features: { analytics: true } }, { id: 'o2', features: {} }]);
    await runSetupSteps(db as any, [analyticsDefaultOffKeepExisting], NOW);
    expect(db.organisation.update).toHaveBeenCalledTimes(1);
    expect(db.organisation.update.mock.calls[0][0].where).toEqual({ id: 'o1' });
  });
});

describe('student-left-at-backfill', () => {
  test('inactive students without left_at get now; nobody else is touched', async () => {
    const db = createMockPrisma();
    db.student.updateMany.mockResolvedValue({ count: 4 });
    expect(await studentLeftAtBackfill.run(db as any, NOW)).toBe('4 inactive student(s) given left_at');
    expect(db.student.updateMany.mock.calls[0][0]).toEqual({
      where: { is_active: false, left_at: null },
      data: { left_at: NOW },
    });
  });
});
