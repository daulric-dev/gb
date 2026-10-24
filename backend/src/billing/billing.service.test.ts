import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, invoiceRow, subRow } from '@/test/billing-fakes';
import { BillingRegistry } from './billing.registry';
import { BillingService } from './billing.service';

let prisma: MockPrisma;
let sub: ReturnType<typeof subRow>;
let subp: FakeProvider;
let manual: FakeProvider;
let invoices: { raise: ReturnType<typeof mock>; voidInvoice: ReturnType<typeof mock> };
let service: BillingService;
const savedEnv = { ...process.env };
const caller = { id: 'admin-1', email: 'admin@x.test' };

beforeEach(() => {
  process.env.BILLING_ENABLED = 'true';
  process.env.PAYMENT_PROVIDERS = 'subp,manual';
  process.env.APP_URL = 'https://app.gb.test';
  process.env.API_URL = 'https://api.gb.test';
  prisma = createMockPrisma();
  sub = subRow({ trial_ends_at: new Date(Date.now() + 5 * 86_400_000) });
  subp = new FakeProvider('subp');
  manual = new FakeProvider('manual', 'invoice');
  manual.payInvoice.mockResolvedValue({ redirectUrl: null, providerRef: null, instructions: 'Pay GB-202610-0001' });
  const registry = new BillingRegistry(prisma as never, [subp, manual]);
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.school.findUnique.mockResolvedValue({ id: 'school-1', name: 'Riverside' });
  prisma.subscription.update.mockImplementation(async ({ data }: any) => Object.assign(sub, data));
  const subscriptions = {
    ensure: async () => sub,
    invalidate: async () => undefined,
    oldestOpenDue: async () => null,
    evaluate: () => ({ status: sub.status, readOnly: false }),
    schoolOfUser: async () => 'school-1',
    entitlement: async () => ({ status: 'trialing', readOnly: false, trialEndsAt: '2026-11-01T00:00:00.000Z' }),
  };
  invoices = {
    raise: mock(async () => ({ invoice: invoiceRow(), created: true })),
    voidInvoice: mock(async () => invoiceRow({ status: 'void' })),
  };
  const seats = { countBillable: async () => 16 };
  service = new BillingService(prisma as never, registry, subscriptions as never, seats as never, invoices as never);
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
  test('contract shape with estimate and enabled providers', async () => {
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
      providers: [
        { id: 'subp', label: 'Fake subp', mode: 'subscription' },
        { id: 'manual', label: 'Fake manual', mode: 'invoice' },
      ],
    });
  });
});

describe('checkout', () => {
  test('subscription mode: provider checkout with prices, seats and return URLs', async () => {
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

  test('flat plan checks out one seat', async () => {
    await service.checkout(caller, 'flat', 'subp');
    expect((subp.createCheckout.mock.calls[0][0] as any).quantity).toBe(1);
  });

  test('invoice mode: plan set, invoice raised, its pay result returned', async () => {
    const result = await service.checkout(caller, 'per_user', 'manual');
    expect(result).toEqual({ redirectUrl: null, instructions: 'Pay GB-202610-0001' });
    expect(invoices.raise).toHaveBeenCalledTimes(1);
    expect(sub).toMatchObject({ plan: 'per_user', provider: 'manual', provider_subscription_id: null });
    expect((manual.payInvoice.mock.calls[0][0] as any).callbackUrl).toBe('https://api.gb.test/api/billing/webhooks/manual');
  });

  test('invoice mode: an open invoice on another plan is replaced', async () => {
    prisma.invoice.findFirst.mockResolvedValue(invoiceRow({ plan: 'flat' }));
    await service.checkout(caller, 'per_user', 'manual');
    expect(invoices.voidInvoice).toHaveBeenCalledTimes(1);
  });

  test('a provider that is not enabled is refused (400)', async () => {
    process.env.PAYMENT_PROVIDERS = 'manual';
    await expect(service.checkout(caller, 'per_user', 'subp')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.checkout(caller, 'per_user', 'nope')).rejects.toBeInstanceOf(BadRequestException);
  });

  test('a live provider subscription must be changed, not re-bought (409)', async () => {
    Object.assign(sub, { provider: 'subp', provider_subscription_id: 'sub_1', status: 'active', plan: 'flat' });
    await expect(service.checkout(caller, 'per_user', 'subp')).rejects.toBeInstanceOf(ConflictException);
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

  test('portal url from the provider, null otherwise', async () => {
    expect(await service.portal('admin-1')).toEqual({ url: 'https://pay.test/portal' });
    Object.assign(sub, { provider: 'manual', provider_subscription_id: null });
    expect(await service.portal('admin-1')).toEqual({ url: null });
  });
});

describe('invoices', () => {
  test('pay: only the school\'s own open invoices', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoiceRow({ school_id: 'other' }));
    await expect(service.payInvoice(caller, 'inv-1', 'manual')).rejects.toBeInstanceOf(NotFoundException);
    prisma.invoice.findUnique.mockResolvedValue(invoiceRow({ status: 'paid' }));
    await expect(service.payInvoice(caller, 'inv-1', 'manual')).rejects.toBeInstanceOf(ConflictException);
    prisma.invoice.findUnique.mockResolvedValue(invoiceRow());
    expect(await service.payInvoice(caller, 'inv-1', 'manual')).toEqual({ redirectUrl: null, instructions: 'Pay GB-202610-0001' });
  });

  test('a subscription-mode provider cannot pay invoices (400)', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoiceRow());
    await expect(service.payInvoice(caller, 'inv-1', 'subp')).rejects.toBeInstanceOf(BadRequestException);
  });

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
        status: 'open',
        provider: 'manual',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        dueAt: '2026-10-15T00:00:00.000Z',
        paidAt: null,
        method: null,
      },
    ]);
  });
});
