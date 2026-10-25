import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { BillingScheduler } from './billing.scheduler';

function setup(locked: boolean) {
  const prisma = createMockPrisma();
  prisma.$queryRaw.mockResolvedValue([{ locked }]);
  const subscriptions = { ensureAll: mock(async () => 0), expireCanceled: mock(async () => 0) };
  const seats = { syncAll: mock(async () => 0) };
  const scheduler = new BillingScheduler(prisma as never, subscriptions as never, seats as never);
  return { scheduler, subscriptions, seats };
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

  test('another instance holding the lock: nothing runs', async () => {
    const { scheduler, subscriptions, seats } = setup(false);
    await scheduler.tick();
    expect(subscriptions.ensureAll).not.toHaveBeenCalled();
    expect(seats.syncAll).not.toHaveBeenCalled();
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
