import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { FakeProvider, subRow } from '@/test/billing-fakes';
import { BillingRegistry } from './billing.registry';
import { SubscriptionService } from './subscription.service';

let prisma: MockPrisma;
let cache: ReturnType<typeof createMockCacheService>;
let service: SubscriptionService;

beforeEach(() => {
  prisma = createMockPrisma();
  cache = createMockCacheService();
  const registry = new BillingRegistry(prisma as never, [new FakeProvider('inv', 'invoice')]);
  service = new SubscriptionService(prisma as never, cache as never, registry);
});

describe('SubscriptionService', () => {
  test('ensure returns an existing row untouched', async () => {
    prisma.subscription.findUnique.mockResolvedValue(subRow());
    expect((await service.ensure('school-1')).id).toBe('sub-1');
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  test('ensure creates a trial from now for an old school (first deploy)', async () => {
    const now = new Date('2026-10-24T00:00:00Z');
    prisma.school.findUnique.mockResolvedValue({ created_at: new Date('2024-01-01T00:00:00Z') });
    prisma.subscription.create.mockImplementation(async ({ data }: any) => subRow(data));
    const row = await service.ensure('school-1', now);
    expect(row.status).toBe('trialing');
    expect(row.trial_ends_at).toEqual(new Date('2026-11-23T00:00:00Z'));
  });

  test('ensure survives a concurrent create', async () => {
    prisma.school.findUnique.mockResolvedValue({ created_at: null });
    prisma.subscription.create.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    prisma.subscription.findUniqueOrThrow.mockResolvedValue(subRow({ id: 'raced' }));
    expect((await service.ensure('school-1')).id).toBe('raced');
  });

  test('entitlement is cached and invalidated', async () => {
    prisma.subscription.findUnique.mockResolvedValue(subRow({ trial_ends_at: new Date(Date.now() + 86_400_000) }));
    const first = await service.entitlement('school-1');
    expect(first.readOnly).toBe(false);
    await service.entitlement('school-1');
    expect(prisma.subscription.findUnique).toHaveBeenCalledTimes(1);
    await service.invalidate('school-1');
    prisma.subscription.findUnique.mockResolvedValue(subRow({ trial_ends_at: new Date(Date.now() - 1000) }));
    expect((await service.entitlement('school-1')).readOnly).toBe(true);
  });

  test('invoice mode uses the oldest open invoice', async () => {
    prisma.subscription.findUnique.mockResolvedValue(
      subRow({ provider: 'inv', plan: 'flat', trial_ends_at: new Date(Date.now() - 50 * 86_400_000) }),
    );
    prisma.invoice.findFirst.mockResolvedValue({ due_at: new Date(Date.now() + 86_400_000) });
    expect((await service.entitlement('school-1')).readOnly).toBe(false);
  });

  test('schoolOfUser: students resolve through their student record', async () => {
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: null, account_type: 'student', student: { school_id: 'school-9' } });
    expect(await service.schoolOfUser('u-student')).toBe('school-9');
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-2', account_type: 'staff', student: null });
    expect(await service.schoolOfUser('u-staff')).toBe('school-2');
    expect(await service.schoolOfUser('u-student')).toBe('school-9'); // cached
    expect(prisma.user_profile.findUnique).toHaveBeenCalledTimes(2);
  });

  test('schoolOfUser: no profile, no school', async () => {
    expect(await service.schoolOfUser('nobody')).toBeNull();
  });
});
