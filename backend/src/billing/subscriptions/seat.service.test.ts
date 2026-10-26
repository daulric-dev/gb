import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, subRow } from '@/test/billing-fakes';
import { BillingRegistry } from '../providers/billing.registry';
import { SeatService } from './seat.service';

let prisma: MockPrisma;
let stripe: FakeProvider;
let seats: SeatService;
let invalidated: string[];

beforeEach(() => {
  prisma = createMockPrisma();
  stripe = new FakeProvider('subp');
  const registry = new BillingRegistry([stripe]);
  invalidated = [];
  const subscriptions = { invalidate: (id: string) => Promise.resolve(void invalidated.push(id)) };
  seats = new SeatService(prisma as never, registry, subscriptions as never);
});

describe('seat counting', () => {
  test('active staff with a membership + active roster students', async () => {
    prisma.user_profile.count.mockResolvedValue(4);
    prisma.student.count.mockResolvedValue(12);
    expect(await seats.countBillable('school-1')).toBe(16);
    const staffWhere = prisma.user_profile.count.mock.calls[0][0].where;
    expect(staffWhere).toMatchObject({
      school_id: 'school-1',
      account_type: 'staff',
      is_active: true,
      school_management: { some: { school_id: 'school-1' } },
    });
    expect(prisma.student.count.mock.calls[0][0].where).toEqual({ school_id: 'school-1', is_active: true });
  });

  test('countAll sums staff and students per school', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ school_id: 'a', n: 2 }, { school_id: 'b', n: 1 }])
      .mockResolvedValueOnce([{ school_id: 'a', n: 10 }, { school_id: 'c', n: 3 }]);
    const counts = await seats.countAll();
    expect(Object.fromEntries(counts)).toEqual({ a: 12, b: 1, c: 3 });
  });
});

describe('seat sync', () => {
  const live = (over = {}) =>
    subRow({ plan: 'per_user', status: 'active', provider: 'subp', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', quantity: 10, ...over });

  test('pushes a changed count to the provider and records it', async () => {
    prisma.subscription.findMany.mockResolvedValue([live()]);
    prisma.$queryRaw.mockResolvedValueOnce([{ school_id: 'school-1', n: 3 }]).mockResolvedValueOnce([{ school_id: 'school-1', n: 9 }]);
    expect(await seats.syncAll()).toBe(1);
    expect(stripe.updateQuantity).toHaveBeenCalledWith(
      { providerSubscriptionId: 'sub_1', providerCustomerId: 'cus_1', plan: 'per_user' },
      12,
    );
    expect(prisma.subscription.update.mock.calls[0][0].data.quantity).toBe(12);
    expect(invalidated).toEqual(['school-1']);
  });

  test('an unchanged count is not sent', async () => {
    prisma.subscription.findMany.mockResolvedValue([live({ quantity: 12 })]);
    prisma.$queryRaw.mockResolvedValueOnce([{ school_id: 'school-1', n: 12 }]).mockResolvedValueOnce([]);
    expect(await seats.syncAll()).toBe(0);
    expect(stripe.updateQuantity).not.toHaveBeenCalled();
  });

  test('an empty school still bills one seat', async () => {
    prisma.subscription.findMany.mockResolvedValue([live({ quantity: 5 })]);
    expect(await seats.syncAll()).toBe(1);
    expect(stripe.updateQuantity.mock.calls[0][1]).toBe(1);
  });

  test('flat plans, unknown providers and dead subscriptions are skipped', async () => {
    prisma.$queryRaw.mockResolvedValue([{ school_id: 'school-1', n: 15 }]);
    // The query filters these out; syncOne refuses them too in case a row slips through.
    for (const sub of [
      live({ plan: 'flat' }),
      live({ provider: 'manual' }), // a removed provider
      live({ status: 'canceled' }),
      live({ provider_subscription_id: null }),
    ]) {
      prisma.subscription.findMany.mockResolvedValue([sub]);
      expect(await seats.syncAll()).toBe(0);
    }
    expect(stripe.updateQuantity).not.toHaveBeenCalled();
  });

  test('a subscription set to cancel at period end is still synced', async () => {
    prisma.subscription.findMany.mockResolvedValue([live({ cancel_at_period_end: true })]);
    prisma.$queryRaw.mockResolvedValueOnce([{ school_id: 'school-1', n: 4 }]).mockResolvedValueOnce([]);
    expect(await seats.syncAll()).toBe(1);
    expect(stripe.updateQuantity.mock.calls[0][1]).toBe(4);
    expect(prisma.subscription.findMany.mock.calls[0][0].where.cancel_at_period_end).toBeUndefined();
  });

  test('a provider failure leaves the stored quantity alone', async () => {
    stripe.updateQuantity.mockRejectedValue(new Error('provider down'));
    prisma.subscription.findMany.mockResolvedValue([live()]);
    prisma.$queryRaw.mockResolvedValue([{ school_id: 'school-1', n: 10 }]);
    expect(await seats.syncAll()).toBe(0);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});
