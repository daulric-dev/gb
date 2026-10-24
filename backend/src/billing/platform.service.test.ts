import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, subRow } from '@/test/billing-fakes';
import { BillingRegistry } from './billing.registry';
import { BillingEnabledGuard, PlatformAdminGuard } from './billing.guards';
import { PlatformService } from './platform.service';

let prisma: MockPrisma;
let platform: PlatformService;
const savedEnv = { ...process.env };

function make() {
  const registry = new BillingRegistry(prisma as never, [new FakeProvider('subp'), new FakeProvider('manual', 'invoice')]);
  const subscriptions = {
    ensureAll: async () => 0,
    ensure: async () => subRow(),
    invalidate: async () => undefined,
    evaluate: (row: any) => ({ status: row.status, readOnly: row.status === 'unpaid' }),
  };
  const seats = { countAll: async () => new Map([['s1', 16]]) };
  return new PlatformService(prisma as never, registry, subscriptions as never, seats as never, {} as never);
}

beforeEach(() => {
  process.env.BILLING_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_EMAILS = 'ops@gb.test';
  process.env.PAYMENT_PROVIDERS = 'manual';
  prisma = createMockPrisma();
  platform = make();
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('platform admin authorisation', () => {
  test('a platform_admin row grants it', async () => {
    prisma.platform_admin.findUnique.mockResolvedValue({ id: 'pa' });
    expect(await platform.isPlatformAdmin('u1')).toBe(true);
  });

  test('a verified account email in PLATFORM_ADMIN_EMAILS grants it', async () => {
    prisma.app_user.findUnique.mockResolvedValue({ email: 'OPS@gb.test', email_verified_at: new Date(), disabled_at: null });
    expect(await platform.isPlatformAdmin('u1')).toBe(true);
  });

  test('an unverified or disabled listed email does not', async () => {
    prisma.app_user.findUnique.mockResolvedValue({ email: 'ops@gb.test', email_verified_at: null, disabled_at: null });
    expect(await platform.isPlatformAdmin('u1')).toBe(false);
    prisma.app_user.findUnique.mockResolvedValue({ email: 'ops@gb.test', email_verified_at: new Date(), disabled_at: new Date() });
    expect(await platform.isPlatformAdmin('u1')).toBe(false);
  });

  test('anyone else, or no user, is not', async () => {
    prisma.app_user.findUnique.mockResolvedValue({ email: 'teacher@gb.test', email_verified_at: new Date(), disabled_at: null });
    expect(await platform.isPlatformAdmin('u1')).toBe(false);
    expect(await platform.isPlatformAdmin(undefined)).toBe(false);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    prisma.app_user.findUnique.mockResolvedValue({ email: 'ops@gb.test', email_verified_at: new Date(), disabled_at: null });
    expect(await platform.isPlatformAdmin('u1')).toBe(false);
  });

  const ctx = (user?: { id: string }) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;

  test('PlatformAdminGuard answers 404 to non-admins and when billing is off', async () => {
    const guard = new PlatformAdminGuard(platform);
    await expect(guard.canActivate(ctx({ id: 'u1' }))).rejects.toBeInstanceOf(NotFoundException);
    prisma.platform_admin.findUnique.mockResolvedValue({ id: 'pa' });
    expect(await guard.canActivate(ctx({ id: 'u1' }))).toBe(true);
    delete process.env.BILLING_ENABLED;
    await expect(guard.canActivate(ctx({ id: 'u1' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  test('BillingEnabledGuard: 404 unless BILLING_ENABLED', () => {
    const guard = new BillingEnabledGuard();
    expect(guard.canActivate()).toBe(true);
    delete process.env.BILLING_ENABLED;
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});

describe('providers', () => {
  test('lists every registered provider with its switches', async () => {
    const list = await platform.providers();
    expect(list.map((p) => [p.id, p.allowedByEnv, p.enabled])).toEqual([
      ['subp', false, false],
      ['manual', true, true],
    ]);
  });

  test('cannot enable one that is not allowed and configured (409)', async () => {
    await expect(platform.setProvider('subp', true, 'admin')).rejects.toBeInstanceOf(ConflictException);
    await expect(platform.setProvider('nope', false, 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('switching off and on is stored per provider', async () => {
    await platform.setProvider('manual', false, 'admin');
    expect(prisma.provider_setting.upsert.mock.calls[0][0]).toMatchObject({
      where: { provider_id: 'manual' },
      create: { provider_id: 'manual', enabled: false, updated_by: 'admin' },
    });
    // Switching off is always allowed, even for an unconfigured provider.
    await platform.setProvider('subp', false, 'admin');
  });
});

describe('overview and schools', () => {
  beforeEach(() => {
    prisma.school.findMany.mockResolvedValue([
      { id: 's1', name: 'Riverside' },
      { id: 's2', name: 'Hilltop' },
      { id: 's3', name: 'Comped' },
    ]);
    prisma.subscription.findMany.mockResolvedValue([
      subRow({ school_id: 's1', status: 'active', plan: 'per_user', quantity: 16 }),
      subRow({ school_id: 's2', status: 'unpaid', plan: 'flat' }),
      subRow({ school_id: 's3', status: 'active', plan: 'flat', comp_until: new Date(Date.now() + 86_400_000) }),
    ]);
    prisma.invoice.findMany.mockImplementation(async ({ where }: any) =>
      where?.status === 'open' ? [{ school_id: 's2', due_at: new Date() }] : [],
    );
  });

  test('overview counts and MRR (excluding read-only and comped schools)', async () => {
    expect(await platform.overview()).toEqual({
      schools: 3,
      trialing: 0,
      active: 2,
      pastDue: 0,
      readOnly: 1,
      mrrCents: 8000,
      currency: 'USD',
      openInvoices: 1,
    });
  });

  test('schools: search and status filter', async () => {
    expect((await platform.schools('river')).map((s) => s.schoolId)).toEqual(['s1']);
    expect((await platform.schools(undefined, 'unpaid')).map((s) => s.schoolId)).toEqual(['s2']);
    const [row] = await platform.schools('river');
    expect(row).toMatchObject({ billableUsers: 16, openInvoices: 0, plan: 'per_user' });
  });

  test('extend trial adds days to the later of now and the current trial end', async () => {
    prisma.school.findUnique.mockResolvedValue({ id: 's1' });
    const before = Date.now();
    await platform.extendTrial('s1', 10);
    const end = prisma.subscription.update.mock.calls[0][0].data.trial_ends_at as Date;
    expect(end.getTime()).toBeGreaterThanOrEqual(before + 10 * 86_400_000);
  });

  test('unknown school is 404', async () => {
    await expect(platform.extendTrial('zz', 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(platform.school('zz')).rejects.toBeInstanceOf(NotFoundException);
  });
});
