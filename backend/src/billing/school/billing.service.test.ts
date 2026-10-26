import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, invoiceRow, subRow } from '@/test/billing-fakes';
import { BillingRegistry } from '../providers/billing.registry';
import { BillingService, checkoutKey } from './billing.service';

let prisma: MockPrisma;
let sub: ReturnType<typeof subRow>;
let subp: FakeProvider;
let other: FakeProvider;
let service: BillingService;
const savedEnv = { ...process.env };
const caller = { id: 'admin-1', email: 'admin@x.test' };

beforeEach(() => {
  process.env.BILLING_ENABLED = 'true';
  process.env.APP_URL = 'https://app.gb.test';
  prisma = createMockPrisma();
  sub = subRow({ trial_ends_at: new Date(Date.now() + 5 * 86_400_000) });
  subp = new FakeProvider('subp');
  other = new FakeProvider('other');
  other.configured = false;
  const registry = new BillingRegistry([subp, other]);
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.school.findUnique.mockResolvedValue({ id: 'school-1', name: 'Riverside' });
  prisma.subscription.update.mockImplementation(async ({ data }: any) => Object.assign(sub, data));
  prisma.subscription.findUnique.mockImplementation(async () => ({ ...sub }));
  const subscriptions = {
    ensure: async () => sub,
    invalidate: async () => undefined,
    evaluate: () => ({ status: sub.status, readOnly: false }),
    schoolOfUser: async () => 'school-1',
    entitlement: async () => ({ status: 'trialing', readOnly: false, trialEndsAt: '2026-11-01T00:00:00.000Z' }),
  };
  const seats = { countBillable: async () => 16 };
  service = new BillingService(prisma as never, registry, subscriptions as never, seats as never);
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('status', () => {
  test('disabled: the fixed "off" answer', async () => {
    delete process.env.BILLING_ENABLED;
    expect(await service.status('u')).toEqual({ enabled: false, readOnly: false, status: null, trialEndsAt: null });
  });
  test('enabled: the school entitlement', async () => {
    expect(await service.status('u')).toEqual({ enabled: true, readOnly: false, status: 'trialing', trialEndsAt: '2026-11-01T00:00:00.000Z' });
  });
});

describe('summary', () => {
  test('contract shape with estimate and the configured providers', async () => {
    const s = await service.summary('admin-1');
    expect(s).toMatchObject({
      enabled: true,
      plan: null,
      status: 'trialing',
      readOnly: false,
      provider: null,
      billableUsers: 16,
      estimatedAmountCents: 8000,
      currency: 'USD',
      prices: { perUserCents: 500, flatCents: 30000 },
      providers: [{ id: 'subp', label: 'Fake subp' }],
      paymentsConfigured: true,
    });
  });

  test('nothing configured: paymentsConfigured false, no providers', async () => {
    subp.configured = false;
    const s = await service.summary('admin-1');
    expect(s.providers).toEqual([]);
    expect(s.paymentsConfigured).toBe(false);
  });
});

describe('checkout', () => {
  test('provider checkout with prices, seats and return URLs', async () => {
    const result = await service.checkout(caller, 'per_user', 'subp');
    expect(result).toEqual({ redirectUrl: 'https://pay.test/checkout' });
    const ctx = subp.createCheckout.mock.calls[0][0] as any;
    expect(ctx).toMatchObject({
      schoolId: 'school-1',
      schoolName: 'Riverside',
      customerEmail: 'admin@x.test',
      quantity: 16,
      price: { plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' },
      successUrl: 'https://app.gb.test/dashboard/settings/billing?checkout=success',
      cancelUrl: 'https://app.gb.test/dashboard/settings/billing?checkout=cancel',
    });
    expect(ctx.idempotencyKey).toBeString();
    expect(sub).toMatchObject({ plan: 'per_user', provider: 'subp', provider_customer_id: 'cus_1', quantity: 16, status: 'trialing' });
  });

  test('no provider named: the configured one is used', async () => {
    await service.checkout(caller, 'flat');
    expect(subp.createCheckout).toHaveBeenCalledTimes(1);
    expect((subp.createCheckout.mock.calls[0][0] as any).quantity).toBe(1);
  });

  test('nothing configured: 503 with a clear message', async () => {
    subp.configured = false;
    const err = await service.checkout(caller, 'flat').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('not configured');
    expect(subp.createCheckout).not.toHaveBeenCalled();
  });

  test('an unconfigured, unknown or removed provider is refused (400)', async () => {
    await expect(service.checkout(caller, 'per_user', 'other')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.checkout(caller, 'per_user', 'nope')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.checkout(caller, 'per_user', 'manual')).rejects.toBeInstanceOf(BadRequestException);
  });

  test('a live provider subscription must be changed, not re-bought (409)', async () => {
    Object.assign(sub, { provider: 'subp', provider_subscription_id: 'sub_1', status: 'active', plan: 'flat' });
    await expect(service.checkout(caller, 'per_user', 'subp')).rejects.toBeInstanceOf(ConflictException);
  });

  test('the checkout session is remembered, and the previous open one expired first', async () => {
    const calls: string[] = [];
    (subp as any).expireCheckoutSession = async (ref: string) => {
      calls.push(ref);
      return true;
    };
    await service.checkout(caller, 'flat', 'subp');
    expect((sub as any).pending_checkout_id).toBe('cs_1');
    expect(calls).toEqual([]);

    subp.createCheckout.mockResolvedValueOnce({ redirectUrl: 'https://pay.test/2', providerRef: 'cs_2', providerCustomerId: 'cus_1' });
    expect(await service.checkout(caller, 'flat', 'subp')).toEqual({ redirectUrl: 'https://pay.test/2' });
    expect(calls).toEqual(['cs_1']);
    expect((sub as any).pending_checkout_id).toBe('cs_2');
  });

  test('a previous checkout that already completed: 409, no second session', async () => {
    Object.assign(sub, { provider: 'subp', pending_checkout_id: 'cs_1' });
    (subp as any).expireCheckoutSession = async () => false;
    await expect(service.checkout(caller, 'flat', 'subp')).rejects.toBeInstanceOf(ConflictException);
    expect(subp.createCheckout).not.toHaveBeenCalled();
  });

  test('a row left by a removed provider can re-subscribe', async () => {
    Object.assign(sub, { provider: 'manual', plan: 'per_user', status: 'trialing', cancel_at_period_end: true });
    expect(await service.checkout(caller, 'flat')).toEqual({ redirectUrl: 'https://pay.test/checkout' });
    expect(sub).toMatchObject({ provider: 'subp', plan: 'flat', provider_subscription_id: null });
  });
});

describe('checkout races', () => {
  /** $transaction as Postgres runs it here: one school-row lock at a time. */
  function serializeTransactions() {
    let tail: Promise<unknown> = Promise.resolve();
    prisma.$transaction.mockImplementation((fn: any) => {
      const run = tail.then(() => fn(prisma));
      tail = run.catch(() => undefined);
      return run;
    });
  }

  test('the school row is locked and read inside the transaction', async () => {
    await service.checkout(caller, 'flat', 'subp');
    const sql = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FROM billing.subscription WHERE school_id = ?::uuid FOR UPDATE');
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe('school-1');
    expect((prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain('lock_timeout');
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 5_000, timeout: 30_000 });
  });

  test('two checkouts at once: the second waits, expires the first session, one stays open', async () => {
    serializeTransactions();
    const expired: string[] = [];
    (subp as any).expireCheckoutSession = async (ref: string) => {
      expired.push(ref);
      return true;
    };
    let n = 0;
    subp.createCheckout.mockImplementation(async () => {
      const ref = `cs_${++n}`;
      await new Promise((r) => setTimeout(r, 20));
      return { redirectUrl: `https://pay.test/${ref}`, providerRef: ref, providerCustomerId: 'cus_1' };
    });

    const [a, b] = await Promise.all([
      service.checkout(caller, 'flat', 'subp'),
      service.checkout({ id: 'admin-2', email: 'other@x.test' }, 'flat', 'subp'),
    ]);
    expect(a.redirectUrl).toBe('https://pay.test/cs_1');
    expect(b.redirectUrl).toBe('https://pay.test/cs_2');
    expect(expired).toEqual(['cs_1']);
    expect((sub as any).pending_checkout_id).toBe('cs_2');
    // Each attempt started from a different row state: different keys.
    const keys = subp.createCheckout.mock.calls.map((c: any) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  test('the idempotency key is derived from the row state the checkout started from', async () => {
    Object.assign(sub, { provider: 'subp', pending_checkout_id: 'cs_0' });
    (subp as any).expireCheckoutSession = async () => true;
    const expected = checkoutKey({ ...sub }, 'subp', 'flat', 1);
    await service.checkout(caller, 'flat', 'subp');
    const key = (subp.createCheckout.mock.calls[0][0] as any).idempotencyKey;
    expect(key).toBe(expected);
    expect(key).toStartWith('gradebook-checkout-');
    // Same state: same key, so a race past the lock still yields one session.
    expect(checkoutKey({ school_id: 'school-1', pending_checkout_id: 'cs_0', updated_at: new Date('2026-01-01T00:00:00Z') }, 'subp', 'flat', 1))
      .toBe(checkoutKey({ school_id: 'school-1', pending_checkout_id: 'cs_0', updated_at: new Date('2026-01-01T00:00:00Z') }, 'subp', 'flat', 1));
    expect(checkoutKey({ school_id: 'school-1', pending_checkout_id: 'cs_0', updated_at: new Date('2026-01-01T00:00:00Z') }, 'subp', 'per_user', 1))
      .not.toBe(checkoutKey({ school_id: 'school-1', pending_checkout_id: 'cs_0', updated_at: new Date('2026-01-01T00:00:00Z') }, 'subp', 'flat', 1));
  });

  test('a session whose id could not be stored is expired again', async () => {
    const expired: string[] = [];
    (subp as any).expireCheckoutSession = async (ref: string) => {
      expired.push(ref);
      return true;
    };
    prisma.subscription.update.mockRejectedValueOnce(new Error('Transaction already closed'));
    await expect(service.checkout(caller, 'flat', 'subp')).rejects.toThrow('Transaction already closed');
    expect(expired).toEqual(['cs_1']);
  });

  test('the lock wait running out answers 409', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(Object.assign(new Error('canceling statement due to lock timeout'), { meta: { code: '55P03' } }));
    await expect(service.checkout(caller, 'flat', 'subp')).rejects.toBeInstanceOf(ConflictException);
    expect(subp.createCheckout).not.toHaveBeenCalled();
  });
});

describe('plan changes, cancel, resume, portal', () => {
  beforeEach(() => {
    Object.assign(sub, { provider: 'subp', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', status: 'active', plan: 'flat' });
  });

  test('change plan goes through the provider with the new seat count', async () => {
    await service.changePlan('admin-1', 'per_user');
    expect(subp.changePlan.mock.calls[0]).toEqual([
      { providerSubscriptionId: 'sub_1', providerCustomerId: 'cus_1', plan: 'flat' },
      { plan: 'per_user', unitAmountCents: 500, currency: 'USD', interval: 'month' },
      16,
    ]);
    expect(sub).toMatchObject({ plan: 'per_user', quantity: 16 });
  });

  test('cancel at period end and resume', async () => {
    await service.setCancel('admin-1', true);
    expect(subp.cancel.mock.calls[0][1]).toEqual({ atPeriodEnd: true });
    expect(sub.cancel_at_period_end).toBe(true);
    await service.setCancel('admin-1', false);
    expect(subp.resume).toHaveBeenCalledTimes(1);
    expect(sub.cancel_at_period_end).toBe(false);
  });

  test('cancel without any subscription is a 409', async () => {
    Object.assign(sub, { provider: null, plan: null });
    await expect(service.setCancel('admin-1', true)).rejects.toBeInstanceOf(ConflictException);
  });

  test('a removed provider id does not crash: changes are recorded locally', async () => {
    Object.assign(sub, { provider: 'manual', provider_subscription_id: null, status: 'trialing', plan: 'per_user' });
    await service.changePlan('admin-1', 'flat');
    await service.setCancel('admin-1', true);
    expect(sub).toMatchObject({ plan: 'flat', cancel_at_period_end: true });
    expect(await service.portal('admin-1')).toEqual({ url: null });
    expect(subp.changePlan).not.toHaveBeenCalled();
    expect(subp.cancel).not.toHaveBeenCalled();
  });

  test('portal url from the provider, null without a subscription', async () => {
    expect(await service.portal('admin-1')).toEqual({ url: 'https://pay.test/portal' });
    Object.assign(sub, { provider_subscription_id: null });
    expect(await service.portal('admin-1')).toEqual({ url: null });
  });
});

describe('invoices', () => {
  test('list maps to the contract shape', async () => {
    prisma.invoice.findMany.mockResolvedValue([invoiceRow()]);
    expect(await service.listInvoices('admin-1')).toEqual([
      {
        id: 'inv-1',
        number: 'GB-202610-0001',
        plan: 'per_user',
        seats: 10,
        amountCents: 5000,
        currency: 'USD',
        status: 'paid',
        provider: 'fake',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        dueAt: '2026-10-01T00:00:00.000Z',
        paidAt: '2026-10-01T00:00:00.000Z',
        method: 'fake',
      },
    ]);
  });
});
