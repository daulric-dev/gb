import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, invoiceRow, subRow } from '@/test/billing-fakes';
import { BillingEventsService } from './billing-events.service';
import type { BillingEvent } from './providers/payment-provider';

const DAY = 86_400_000;
const T0 = new Date('2026-10-01T00:00:00Z');
const at = (d: number) => new Date(T0.getTime() + d * DAY);

let prisma: MockPrisma;
let sub: ReturnType<typeof subRow>;
let events: Map<string, any>;
let invoices: ReturnType<typeof invoiceRow>[];
let service: BillingEventsService;
let invoiceSvc: { markPaidByProvider: ReturnType<typeof mock>; createNumbered: ReturnType<typeof mock> };
let invalidated: (string | null | undefined)[];
const stripe = new FakeProvider('subp');
const wipay = new FakeProvider('wipay', 'invoice');

beforeEach(() => {
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
    const row = { id: `pe-${events.size + 1}`, processed_at: null, error: null, school_id: null, ...data };
    events.set(key, row);
    return row;
  });
  prisma.payment_event.update.mockImplementation(async ({ where, data }: any) => {
    const row = [...events.values()].find((e) => e.id === where.id);
    Object.assign(row, data);
    return row;
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
    markPaidByProvider: mock(async () => true),
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
});

describe('invoice.paid', () => {
  test('invoice mode: our invoice is marked paid through the invoice service', async () => {
    invoices.push(invoiceRow({ id: 'inv-ours' }));
    await service.handle(wipay, [{ type: 'invoice.paid', eventId: 'w1', invoiceId: 'inv-ours', providerInvoiceId: 'TXN', amountCents: 5000, currency: 'USD', paidAt: at(3) }]);
    expect(invoiceSvc.markPaidByProvider).toHaveBeenCalledTimes(1);
    expect(invoiceSvc.markPaidByProvider.mock.calls[0].slice(1)).toEqual(['wipay', at(3), 'TXN']);
    expect(events.get('wipay:w1').school_id).toBe('school-1');
  });

  test('invoice mode: unknown invoice id is ignored', async () => {
    expect(await service.handle(wipay, [{ type: 'invoice.paid', eventId: 'w2', invoiceId: 'nope', amountCents: 1, currency: 'USD', paidAt: at(1) }])).toBe(1);
    expect(invoiceSvc.markPaidByProvider).not.toHaveBeenCalled();
  });

  test('subscription mode: records a paid history invoice once and extends the period', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    const paid: BillingEvent = { type: 'invoice.paid', eventId: 'p1', providerInvoiceId: 'in_1', providerSubscriptionId: 'sub_A', amountCents: 8000, currency: 'usd', paidAt: at(31), periodStart: at(31), periodEnd: at(61) };
    await service.handle(stripe, [paid]);
    await service.handle(stripe, [{ ...paid, eventId: 'p1-redelivered-with-new-id' }]);
    expect(invoiceSvc.createNumbered).toHaveBeenCalledTimes(1);
    expect(invoices[0]).toMatchObject({ status: 'paid', amount_cents: 8000, currency: 'USD', provider: 'subp', provider_invoice_id: 'in_1' });
    expect(sub.status).toBe('active');
    expect(sub.current_period_end).toEqual(at(61));
  });

  test('subscription mode: an older payment does not move the period back', async () => {
    await service.handle(stripe, [updated({ eventId: 'a', currentPeriodEnd: at(61) })]);
    await service.handle(stripe, [{ type: 'invoice.paid', eventId: 'p0', providerInvoiceId: 'in_0', providerSubscriptionId: 'sub_A', amountCents: 8000, currency: 'USD', paidAt: at(0), periodStart: at(0), periodEnd: at(31) }]);
    expect(sub.current_period_end).toEqual(at(61));
  });
});

describe('invoice.payment_failed', () => {
  test('subscription mode: active becomes past_due', async () => {
    await service.handle(stripe, [updated({ eventId: 'a' })]);
    await service.handle(stripe, [{ type: 'invoice.payment_failed', eventId: 'f', providerSubscriptionId: 'sub_A' }]);
    expect(sub.status).toBe('past_due');
  });

  test('invoice mode: our invoice stays open, nothing changes', async () => {
    invoices.push(invoiceRow({ id: 'inv-ours' }));
    await service.handle(wipay, [{ type: 'invoice.payment_failed', eventId: 'f2', invoiceId: 'inv-ours' }]);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});
