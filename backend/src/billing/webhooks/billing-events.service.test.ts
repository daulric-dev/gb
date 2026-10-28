import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, invoiceRow, subRow } from '@/test/billing-fakes';
import { BillingEventsService, EventInProgressError } from './billing-events.service';
import type { BillingEvent } from '../providers/payment-provider';

const DAY = 86_400_000;
const T0 = new Date('2026-10-01T00:00:00Z');
const at = (d: number) => new Date(T0.getTime() + d * DAY);

let prisma: MockPrisma;
let sub: ReturnType<typeof subRow>;
let events: Map<string, any>;
let invoices: ReturnType<typeof invoiceRow>[];
let service: BillingEventsService;
let invoiceSvc: { createNumbered: ReturnType<typeof mock> };
let invalidated: (string | null | undefined)[];
const stripe = new FakeProvider('subp');

beforeEach(() => {
  stripe.cancel.mockClear();
  prisma = createMockPrisma();
  sub = subRow({ school_id: 'school-1' });
  events = new Map();
  invoices = [];
  invalidated = [];

  prisma.payment_event.findUnique.mockImplementation(async ({ where }: any) =>
    events.get(`${where.provider_event_id.provider}:${where.provider_event_id.event_id}`) ?? null,
  );
  prisma.payment_event.create.mockImplementation(async ({ data }: any) => {
    const key = `${data.provider}:${data.event_id}`;
    if (events.has(key)) throw Object.assign(new Error('dup'), { code: '23505' });
    const row = { id: `pe-${events.size + 1}`, processed_at: null, processing_at: null, error: null, school_id: null, ...data };
    events.set(key, row);
    return row;
  });
  prisma.payment_event.update.mockImplementation(async ({ where, data }: any) => {
    const row = [...events.values()].find((e) => e.id === where.id);
    Object.assign(row, data);
    return row;
  });
  // The atomic claim: UPDATE ... WHERE processed_at IS NULL AND (unclaimed or stale claim).
  prisma.$executeRaw.mockImplementation(async (_sql: TemplateStringsArray, id: string) => {
    const row = [...events.values()].find((e) => e.id === id);
    if (!row || row.processed_at) return 0;
    if (row.processing_at && row.processing_at.getTime() > Date.now() - 5 * 60_000) return 0;
    row.processing_at = new Date();
    return 1;
  });
  prisma.subscription.findFirst.mockImplementation(async ({ where }: any) =>
    sub.provider === where.provider && sub.provider_subscription_id === where.provider_subscription_id ? sub : null,
  );
  prisma.subscription.update.mockImplementation(async ({ data }: any) => Object.assign(sub, data));
  prisma.school.findUnique.mockImplementation(async ({ where }: any) => (where.id === 'school-1' ? { id: 'school-1' } : null));
  prisma.invoice.findUnique.mockImplementation(async ({ where }: any) =>
    where.id
      ? (invoices.find((i) => i.id === where.id) ?? null)
      : (invoices.find(
          (i) => i.provider === where.provider_provider_invoice_id.provider && i.provider_invoice_id === where.provider_provider_invoice_id.provider_invoice_id,
        ) ?? null),
  );

  invoiceSvc = {
    createNumbered: mock(async (data: any) => {
      const row = invoiceRow({ ...data, id: `inv-${invoices.length + 1}` });
      invoices.push(row);
      return row;
    }),
  };
  const subscriptions = {
    ensure: async () => sub,
    invalidate: async (id: string | null | undefined) => void invalidated.push(id),
  };
  service = new BillingEventsService(prisma as never, subscriptions as never, invoiceSvc as never);
});

const updated = (over: Partial<Extract<BillingEvent, { type: 'subscription.updated' }>> = {}): BillingEvent => ({
  type: 'subscription.updated',
  eventId: 'evt_1',
  providerSubscriptionId: 'sub_A',
  providerCustomerId: 'cus_1',
  schoolId: 'school-1',
  status: 'active',
  plan: 'per_user',
  quantity: 16,
  currentPeriodStart: at(0),
  currentPeriodEnd: at(31),
  cancelAtPeriodEnd: false,
  ...over,
});

describe('idempotency', () => {
  test('the same event applies once', async () => {
    expect(await service.handle(stripe, [updated()])).toBe(1);
    expect(await service.handle(stripe, [updated()])).toBe(0);
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    const row = events.get('subp:evt_1');
    expect(row.processed_at).toBeInstanceOf(Date);
    expect(row.school_id).toBe('school-1');
    expect(invalidated).toContain('school-1');
  });

  test('the same event id from another provider is a different event', async () => {
    sub.provider = null;
    await service.handle(stripe, [updated()]);
    expect(await service.handle(new FakeProvider('other'), [updated()])).toBe(1);
  });

  test('a failure is recorded and rethrown, and a retry then succeeds', async () => {
    prisma.subscription.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.handle(stripe, [updated()])).rejects.toThrow('db down');
    const row = events.get('subp:evt_1');
    expect(row.error).toBe('db down');
    expect(row.processed_at).toBeNull();
    expect(await service.handle(stripe, [updated()])).toBe(1);
    expect(row.error).toBeNull();
    expect(row.processed_at).toBeInstanceOf(Date);
  });

  test('a delivery racing one in progress is refused for a retry, and the retry is a no-op', async () => {
    let release!: () => void;
    prisma.subscription.update.mockImplementationOnce(
      ({ data }: any) => new Promise((resolve) => (release = () => resolve(Object.assign(sub, data)))),
    );
    const first = service.handle(stripe, [updated()]);
    await new Promise((r) => setTimeout(r, 0));
    await expect(service.handle(stripe, [updated()])).rejects.toBeInstanceOf(EventInProgressError);
    release();
    expect(await first).toBe(1);
    expect(await service.handle(stripe, [updated()])).toBe(0);
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
  });

  test('a claim abandoned for over 5 minutes is taken over', async () => {
    events.set('subp:evt_1', { id: 'pe-1', provider: 'subp', event_id: 'evt_1', processed_at: null, processing_at: new Date(Date.now() - 6 * 60_000), error: null });
    expect(await service.handle(stripe, [updated()])).toBe(1);
  });

  test('a failure releases the claim so the retry is not refused', async () => {
    prisma.subscription.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.handle(stripe, [updated()])).rejects.toThrow('db down');
    expect(events.get('subp:evt_1').processing_at).toBeNull();
  });

  test('ignored events are recorded and change nothing', async () => {
    expect(await service.handle(stripe, [{ type: 'ignored', eventId: 'evt_x', reason: 'customer.created' }])).toBe(1);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(events.get('subp:evt_x').type).toBe('ignored');
  });

  test('events without an id are refused', async () => {
    await expect(service.handle(stripe, [updated({ eventId: '' })])).rejects.toThrow();
  });
});

describe('subscription.updated', () => {
  test('first event links the school (by our schoolId) and stores everything', async () => {
    await service.handle(stripe, [updated()]);
    expect(sub).toMatchObject({
      provider: 'subp',
      provider_subscription_id: 'sub_A',
      provider_customer_id: 'cus_1',
      status: 'active',
      plan: 'per_user',
      quantity: 16,
      current_period_end: at(31),
      cancel_at_period_end: false,
    });
  });

  test('later events find the school by subscription id alone', async () => {
    await service.handle(stripe, [updated()]);
    await service.handle(stripe, [updated({ eventId: 'evt_2', schoolId: null, currentPeriodEnd: at(62), status: 'past_due' })]);
    expect(sub.status).toBe('past_due');
    expect(sub.current_period_end).toEqual(at(62));
  });

  test('out of order: an older update after a newer one is ignored', async () => {
    await service.handle(stripe, [updated({ eventId: 'new', currentPeriodEnd: at(62), status: 'active' })]);
    await service.handle(stripe, [updated({ eventId: 'old', currentPeriodEnd: at(31), status: 'past_due' })]);
    expect(sub.status).toBe('active');
    expect(sub.current_period_end).toEqual(at(62));
    expect(events.get('subp:old').processed_at).toBeInstanceOf(Date);
  });

  test('same period: the later delivery wins (cancel_at_period_end toggles)', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    await service.handle(stripe, [updated({ eventId: 'b', cancelAtPeriodEnd: true })]);
    expect(sub.cancel_at_period_end).toBe(true);
  });

  test('a canceled subscription is not revived by an older update', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    await service.handle(stripe, [{ type: 'subscription.canceled', eventId: 'c', providerSubscriptionId: 'sub_A' }]);
    expect(sub.status).toBe('canceled');
    await service.handle(stripe, [updated({ eventId: 'late', status: 'active' })]);
    expect(sub.status).toBe('canceled');
  });

  test('news about a superseded subscription does not touch the live one', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', providerSubscriptionId: 'sub_NEW' })]);
    await service.handle(stripe, [updated({ eventId: 'b', providerSubscriptionId: 'sub_OLD', status: 'incomplete' })]);
    expect(sub.provider_subscription_id).toBe('sub_NEW');
    expect(sub.status).toBe('active');
  });

  test('an event created before the newest applied one is ignored', async () => {
    await service.handle(stripe, [updated({ eventId: 'new', occurredAt: at(5), status: 'past_due' })]);
    expect((sub as any).last_event_at).toEqual(at(5));
    await service.handle(stripe, [updated({ eventId: 'old', occurredAt: at(4), status: 'active' })]);
    expect(sub.status).toBe('past_due');
    await service.handle(stripe, [updated({ eventId: 'newer', occurredAt: at(6), status: 'active' })]);
    expect(sub.status).toBe('active');
    expect((sub as any).last_event_at).toEqual(at(6));
  });

  test('with getSubscription, the provider state is applied, not the event', async () => {
    (stripe as any).getSubscription = mock(async (id: string) => ({
      providerSubscriptionId: id, providerCustomerId: 'cus_1', schoolId: 'school-1', status: 'past_due',
      plan: 'per_user', quantity: 9, currentPeriodStart: at(31), currentPeriodEnd: at(62), cancelAtPeriodEnd: false,
    }));
    try {
      await service.handle(stripe, [updated({ status: 'active' })]);
      expect(sub).toMatchObject({ status: 'past_due', quantity: 9, current_period_start: at(31), current_period_end: at(62) });
    } finally {
      delete (stripe as any).getSubscription;
    }
  });

  test('a second live subscription for the school is canceled, not stored', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', providerSubscriptionId: 'sub_A' })]);
    await service.handle(stripe, [updated({ eventId: 'b', providerSubscriptionId: 'sub_B', status: 'active' })]);
    expect(sub.provider_subscription_id).toBe('sub_A');
    expect(stripe.cancel).toHaveBeenCalledWith(
      { providerSubscriptionId: 'sub_B', providerCustomerId: 'cus_1', plan: 'per_user' },
      { atPeriodEnd: false },
    );
  });

  test('the duplicate is refunded right away when its invoice is already paid', async () => {
    const refund = mock(async () => ({ providerInvoiceId: 'in_B', refundIds: ['re_1'], amountCents: 30000, currency: 'USD' }));
    (stripe as any).refundLatestPayment = refund;
    const warn = spyOn((service as any).logger, 'warn');
    try {
      await service.handle(stripe, [updated({ eventId: 'a', providerSubscriptionId: 'sub_A' })]);
      await service.handle(stripe, [updated({ eventId: 'b', providerSubscriptionId: 'sub_B' })]);
      expect(stripe.cancel).toHaveBeenCalledTimes(1);
      expect(refund).toHaveBeenCalledWith('sub_B');
      expect(events.get('subp:duplicate:sub_B')).toMatchObject({ school_id: 'school-1', processed_at: expect.any(Date) });
      expect(warn.mock.calls.some((c) => /Refunded 30000 USD of invoice in_B .*sub_B of school school-1/.test(String(c[0])))).toBe(true);
    } finally {
      delete (stripe as any).refundLatestPayment;
    }
  });

  test('a duplicate paid after the refusal is refunded on invoice.paid, not recorded', async () => {
    const refund = mock(async (): Promise<any> => null);
    (stripe as any).refundLatestPayment = refund;
    try {
      await service.handle(stripe, [updated({ eventId: 'a', providerSubscriptionId: 'sub_A' })]);
      await service.handle(stripe, [updated({ eventId: 'b', providerSubscriptionId: 'sub_B', status: 'incomplete' })]);
      // Not live yet: nothing refused. Then it becomes active, still unpaid.
      await service.handle(stripe, [updated({ eventId: 'c', providerSubscriptionId: 'sub_B' })]);
      expect(refund).toHaveBeenCalledTimes(1);

      refund.mockImplementation(async () => ({ providerInvoiceId: 'in_B', refundIds: ['re_2'], amountCents: 30000, currency: 'USD' }));
      await service.handle(stripe, [{
        type: 'invoice.paid', eventId: 'd', providerInvoiceId: 'in_B', providerSubscriptionId: 'sub_B', schoolId: 'school-1',
        amountCents: 30000, currency: 'usd', paidAt: at(1), periodStart: at(1), periodEnd: at(32),
      }]);
      expect(refund).toHaveBeenCalledTimes(2);
      expect(invoices).toHaveLength(0);
      expect(sub.provider_subscription_id).toBe('sub_A');
    } finally {
      delete (stripe as any).refundLatestPayment;
    }
  });

  test('a failed refund is logged for a manual refund and does not fail the event', async () => {
    (stripe as any).refundLatestPayment = mock(async () => {
      throw new Error('charge_disputed');
    });
    const error = spyOn((service as any).logger, 'error');
    try {
      await service.handle(stripe, [updated({ eventId: 'a', providerSubscriptionId: 'sub_A' })]);
      expect(await service.handle(stripe, [updated({ eventId: 'b', providerSubscriptionId: 'sub_B' })])).toBe(1);
      expect(stripe.cancel).toHaveBeenCalledTimes(1);
      expect(error.mock.calls.some((c) => /Refund of duplicate subscription sub_B of school school-1 failed: charge_disputed - refund it by hand/.test(String(c[0])))).toBe(true);
    } finally {
      delete (stripe as any).refundLatestPayment;
    }
  });

  test('a new subscription replaces one the provider says is no longer live', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', providerSubscriptionId: 'sub_A' })]);
    (stripe as any).getSubscription = mock(async (id: string) =>
      id === 'sub_A'
        ? { providerSubscriptionId: 'sub_A', providerCustomerId: 'cus_1', schoolId: 'school-1', status: 'canceled', plan: 'per_user', quantity: 1, currentPeriodStart: at(0), currentPeriodEnd: at(31), cancelAtPeriodEnd: false }
        : null,
    );
    try {
      await service.handle(stripe, [updated({ eventId: 'b', providerSubscriptionId: 'sub_B', currentPeriodEnd: at(40) })]);
      expect(sub.provider_subscription_id).toBe('sub_B');
      expect(stripe.cancel).not.toHaveBeenCalled();
    } finally {
      delete (stripe as any).getSubscription;
    }
  });

  test('applying a subscription clears the pending checkout session', async () => {
    (sub as any).pending_checkout_id = 'cs_1';
    await service.handle(stripe, [updated()]);
    expect((sub as any).pending_checkout_id).toBeNull();
  });

  test('unknown school: logged, recorded, no error', async () => {
    expect(await service.handle(stripe, [updated({ schoolId: 'nope', providerSubscriptionId: 'sub_Z' })])).toBe(1);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(events.get('subp:evt_1').school_id).toBeNull();
  });
});

describe('subscription.canceled', () => {
  test('only cancels the subscription the school holds', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    await service.handle(stripe, [{ type: 'subscription.canceled', eventId: 'c', providerSubscriptionId: 'sub_OTHER', schoolId: 'school-1' }]);
    expect(sub.status).toBe('active');
    await service.handle(stripe, [{ type: 'subscription.canceled', eventId: 'd', providerSubscriptionId: 'sub_A' }]);
    expect(sub.status).toBe('canceled');
    expect(sub.current_period_end).toEqual(at(31)); // paid-through kept
  });

  test('canceled while past_due: paid through the start of the unpaid period only', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', status: 'past_due', currentPeriodStart: at(31), currentPeriodEnd: at(62) })]);
    await service.handle(stripe, [{ type: 'subscription.canceled', eventId: 'c', providerSubscriptionId: 'sub_A' }]);
    expect(sub.status).toBe('canceled');
    expect(sub.current_period_end).toEqual(at(31));
  });
});

describe('invoice.paid', () => {
  test('records a paid history invoice once and extends the period', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    const paid: BillingEvent = { type: 'invoice.paid', eventId: 'p1', providerInvoiceId: 'in_1', providerSubscriptionId: 'sub_A', amountCents: 8000, currency: 'usd', paidAt: at(31), periodStart: at(31), periodEnd: at(61) };
    await service.handle(stripe, [paid]);
    await service.handle(stripe, [{ ...paid, eventId: 'p1-redelivered-with-new-id' }]);
    expect(invoiceSvc.createNumbered).toHaveBeenCalledTimes(1);
    expect(invoices[0]).toMatchObject({ status: 'paid', amount_cents: 8000, currency: 'USD', provider: 'subp', provider_invoice_id: 'in_1' });
    expect(sub.status).toBe('active');
    expect(sub.current_period_end).toEqual(at(61));
  });

  test('an invoice.paid older than the newest applied event does not force active', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', occurredAt: at(10), status: 'past_due' })]);
    await service.handle(stripe, [{ type: 'invoice.paid', eventId: 'p', occurredAt: at(9), providerInvoiceId: 'in_9', providerSubscriptionId: 'sub_A', amountCents: 8000, currency: 'USD', paidAt: at(9), periodStart: at(31), periodEnd: at(61) }]);
    expect(sub.status).toBe('past_due');
    expect(invoiceSvc.createNumbered).toHaveBeenCalledTimes(1); // history still recorded
  });

  test('with getSubscription, invoice.paid applies the provider state', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    (stripe as any).getSubscription = mock(async () => ({
      providerSubscriptionId: 'sub_A', providerCustomerId: 'cus_1', schoolId: 'school-1', status: 'past_due',
      plan: 'per_user', quantity: 16, currentPeriodStart: at(61), currentPeriodEnd: at(92), cancelAtPeriodEnd: false,
    }));
    try {
      await service.handle(stripe, [{ type: 'invoice.paid', eventId: 'p', providerInvoiceId: 'in_1', providerSubscriptionId: 'sub_A', amountCents: 8000, currency: 'USD', paidAt: at(31), periodStart: at(31), periodEnd: at(61) }]);
      expect(sub.status).toBe('past_due');
      expect(sub.current_period_end).toEqual(at(92));
    } finally {
      delete (stripe as any).getSubscription;
    }
  });

  test('an older payment does not move the period back', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', currentPeriodEnd: at(61) })]);
    await service.handle(stripe, [{ type: 'invoice.paid', eventId: 'p0', providerInvoiceId: 'in_0', providerSubscriptionId: 'sub_A', amountCents: 8000, currency: 'USD', paidAt: at(0), periodStart: at(0), periodEnd: at(31) }]);
    expect(sub.current_period_end).toEqual(at(61));
  });
});

describe('invoice.payment_failed', () => {
  test('active becomes past_due', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    await service.handle(stripe, [{ type: 'invoice.payment_failed', eventId: 'f', providerSubscriptionId: 'sub_A' }]);
    expect(sub.status).toBe('past_due');
  });
});
