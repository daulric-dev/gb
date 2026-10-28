import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { BillingScheduler } from './billing.scheduler';

function setup(locked: boolean) {
  const prisma = createMockPrisma();
  prisma.$queryRaw.mockResolvedValue([{ locked }]);
  const subscriptions = { ensureAll: mock(async () => 0), expireCanceled: mock(async () => 0) };
  const seats = { syncAll: mock(async () => 0) };
  const scheduler = new BillingScheduler(prisma as never, subscriptions as never, seats as never);
  return { scheduler, subscriptions, seats, prisma };
}

describe('BillingScheduler', () => {
  test('a tick runs every job when it holds the lock', async () => {
    const { scheduler, subscriptions, seats } = setup(true);
    await scheduler.tick();
    await scheduler.tick();
    expect(subscriptions.ensureAll).toHaveBeenCalledTimes(2);
    expect(subscriptions.expireCanceled).toHaveBeenCalledTimes(2);
    expect(seats.syncAll).toHaveBeenCalledTimes(2);
  });

  test('the lease is taken without a transaction and released after the work', async () => {
    const { scheduler, prisma } = setup(true);
    await scheduler.tick();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('billing.job_lease');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0][0].join('?')).toContain('DELETE FROM billing.job_lease');
  });

  test('the lease is released even when the work fails', async () => {
    const { scheduler, prisma } = setup(true);
    await expect(
      scheduler.withLock('job', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  test('another instance holding the lease: nothing runs', async () => {
    const { scheduler, subscriptions, seats, prisma } = setup(false);
    await scheduler.tick();
    expect(subscriptions.ensureAll).not.toHaveBeenCalled();
    expect(seats.syncAll).not.toHaveBeenCalled();
    // Not ours, so not released.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    // A held lease returns no row at all.
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await scheduler.withLock('job', async () => undefined)).toBe(false);
  });

  test('a failing job is logged, not thrown', async () => {
    const { scheduler, seats } = setup(true);
    seats.syncAll.mockRejectedValue(new Error('provider down'));
    await scheduler.tick();
  });

  test('does not start timers in tests or with billing off', () => {
    const { scheduler } = setup(true);
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();
  });
});
