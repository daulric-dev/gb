import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { RetentionScheduler } from './retention.scheduler';

const ENV = ['RETENTION_PURGE_ENABLED', 'RETENTION_PURGE_INTERVAL_HOURS', 'RETENTION_PURGE_HOUR_UTC'];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setup(locked: boolean) {
  const prisma = createMockPrisma();
  prisma.$queryRaw.mockResolvedValue([{ locked }]);
  const retention = { purge: mock(async () => ({})) };
  const erasure = { exportPending: mock(async () => 0) };
  const scheduler = new RetentionScheduler(prisma as never, retention as never, erasure as never);
  return { prisma, scheduler, retention, erasure };
}

const at = (iso: string) => new Date(iso).getTime();

describe('RetentionScheduler', () => {
  test('purges at the configured UTC hour, once a day, under the advisory lock', async () => {
    const { prisma, scheduler, retention } = setup(true);
    await scheduler.tick(at('2026-10-25T02:50:00Z'));
    expect(retention.purge).not.toHaveBeenCalled();
    await scheduler.tick(at('2026-10-25T03:05:00Z'));
    expect(retention.purge).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe('gradebook:retention:purge');
    await scheduler.tick(at('2026-10-25T03:20:00Z'));
    expect(retention.purge).toHaveBeenCalledTimes(1);
    await scheduler.tick(at('2026-10-26T03:01:00Z'));
    expect(retention.purge).toHaveBeenCalledTimes(2);
  });

  test('another instance holding the lock: nothing runs here', async () => {
    const { scheduler, retention } = setup(false);
    await scheduler.tick(at('2026-10-25T03:00:00Z'));
    expect(retention.purge).not.toHaveBeenCalled();
  });

  test('every tick retries the erasure-log export, even when no purge is due', async () => {
    const { scheduler, erasure, retention } = setup(true);
    await scheduler.tick(at('2026-10-25T12:00:00Z'));
    expect(erasure.exportPending).toHaveBeenCalledTimes(1);
    expect(retention.purge).not.toHaveBeenCalled();
  });

  test('RETENTION_PURGE_ENABLED=false stops the purge', async () => {
    process.env.RETENTION_PURGE_ENABLED = 'false';
    const { scheduler, retention } = setup(true);
    await scheduler.tick(at('2026-10-25T03:00:00Z'));
    expect(retention.purge).not.toHaveBeenCalled();
  });

  test('a shorter interval ignores the hour', async () => {
    process.env.RETENTION_PURGE_INTERVAL_HOURS = '6';
    const { scheduler, retention } = setup(true);
    await scheduler.tick(at('2026-10-25T12:00:00Z'));
    await scheduler.tick(at('2026-10-25T15:00:00Z'));
    await scheduler.tick(at('2026-10-25T18:00:00Z'));
    expect(retention.purge).toHaveBeenCalledTimes(2);
  });

  test('failures are logged, never thrown', async () => {
    const { prisma, scheduler, erasure } = setup(true);
    erasure.exportPending.mockRejectedValue(new Error('storage down'));
    prisma.$transaction.mockRejectedValue(new Error('db down'));
    await scheduler.tick(at('2026-10-25T03:00:00Z'));
  });

  test('no timers in tests', () => {
    const { scheduler } = setup(true);
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();
  });
});
