import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma } from '@/test/prisma-mock';
import { describeReport, hardenDatabase, hardenOnBoot, prepareDatabase, SETUP_LEASE_KEY } from './database-setup';
import { ApplicationOnlyHardening } from './hardening';
import type { DatabaseHardening, HardeningReport } from './types';

const quiet = () => ({
  log: mock((_message: string) => undefined),
  warn: mock((_message: string) => undefined),
  error: mock((_message: string) => undefined),
});

const fixed = (report: Partial<HardeningReport>): DatabaseHardening => ({
  provider: 'postgresql',
  prepare: async () => ({ provider: 'postgresql', implemented: true, results: [], warnings: [], ...report }),
  apply: async () => ({ provider: 'postgresql', implemented: true, results: [], warnings: [], ...report }),
});

describe('database setup', () => {
  test('harden runs under the database-setup job lease, then the steps', async () => {
    const prisma = createMockPrisma();
    const order: string[] = [];
    prisma.job_lease.create.mockImplementation(async () => (order.push('lease'), {}));
    const hardening = fixed({});
    hardening.apply = async () => (order.push('apply'), { provider: 'postgresql', implemented: true, results: [], warnings: [] });
    const ok = await hardenDatabase(prisma as any, quiet(), {
      hardening,
      steps: [{ key: 's', description: 's', run: async () => (order.push('step'), 'done') }],
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['lease', 'apply', 'step']);
    expect(prisma.job_lease.create.mock.calls[0][0].data.key).toBe(SETUP_LEASE_KEY);
    // Released afterwards.
    expect(prisma.job_lease.updateMany).toHaveBeenCalled();
  });

  test('another instance holding the lease: skipped, not an error', async () => {
    const prisma = createMockPrisma();
    prisma.job_lease.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }));
    prisma.job_lease.updateMany.mockResolvedValue({ count: 0 });
    const applied = mock(async () => ({ provider: 'postgresql' as const, implemented: true, results: [], warnings: [] }));
    const logger = quiet();
    const ok = await hardenDatabase(prisma as any, logger, { hardening: { ...fixed({}), apply: applied }, steps: [] });
    expect(ok).toBe(true);
    expect(applied).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls[0][0]).toContain('Another instance');
  });

  test('a failed object makes the run fail (non-zero exit in the scripts)', async () => {
    const prisma = createMockPrisma();
    const ok = await hardenDatabase(prisma as any, quiet(), {
      hardening: fixed({ results: [{ kind: 'trigger', name: 't', outcome: 'failed', detail: 'x' }] }),
      steps: [],
    });
    expect(ok).toBe(false);
    expect(await prepareDatabase(prisma as any, quiet(), fixed({ results: [{ kind: 'extension', name: 'pg_trgm', outcome: 'failed' }] }))).toBe(false);
  });

  test('providers without hardening are logged as application-only, and that is not a failure', async () => {
    const prisma = createMockPrisma();
    const logger = quiet();
    expect(await hardenDatabase(prisma as any, logger, { hardening: new ApplicationOnlyHardening('mysql'), steps: [] })).toBe(true);
    expect(logger.warn.mock.calls.map((c: any) => c[0]).join('\n')).toContain('only application-level enforcement applies');
    expect(logger.log.mock.calls[0][0]).toBe('harden (mysql): application-level enforcement only');
  });

  test('the report lists only what changed', () => {
    const lines = describeReport('harden', {
      provider: 'postgresql',
      implemented: true,
      warnings: [],
      results: [
        { kind: 'check', name: 'a', outcome: 'unchanged' },
        { kind: 'check', name: 'b', outcome: 'created' },
        { kind: 'trigger', name: 'c', outcome: 'unchanged' },
      ],
    });
    expect(lines).toEqual(['harden (postgresql): 2 unchanged, 1 created', '  created: check b']);
  });

  test('DB_HARDEN_ON_BOOT is opt-in', () => {
    expect(hardenOnBoot({})).toBe(false);
    expect(hardenOnBoot({ DB_HARDEN_ON_BOOT: 'false' })).toBe(false);
    expect(hardenOnBoot({ DB_HARDEN_ON_BOOT: '1' })).toBe(false);
    expect(hardenOnBoot({ DB_HARDEN_ON_BOOT: 'true' })).toBe(true);
    expect(hardenOnBoot({ DB_HARDEN_ON_BOOT: ' TRUE ' })).toBe(true);
  });
});
