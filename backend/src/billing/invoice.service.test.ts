import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FakeProvider, invoiceRow, subRow } from '@/test/billing-fakes';
import { BillingRegistry } from './billing.registry';
import { formatNumber, InvoiceService, numberPrefix } from './invoice.service';

const DAY = 86_400_000;
const NOW = new Date('2026-10-24T12:00:00Z');
type Inv = ReturnType<typeof invoiceRow>;
type Sub = ReturnType<typeof subRow>;

let prisma: MockPrisma;
let invoices: Inv[];
let subs: Map<string, Sub>;
let service: InvoiceService;
let invalidated: string[];
let billable: number;

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

/** An in-memory invoice/subscription table behind the mock, incl. the unique period index. */
beforeEach(() => {
  process.env.PAYMENT_PROVIDERS = 'manual,subp';
  delete process.env.BILLING_CURRENCY;
  delete process.env.BILLING_PER_USER_CENTS;
  delete process.env.BILLING_FLAT_CENTS;
  prisma = createMockPrisma();
  invoices = [];
  subs = new Map();
  invalidated = [];
  billable = 10;
  let ids = 0;

  prisma.invoice.findFirst.mockImplementation(async ({ where }: any) =>
    invoices
      .filter((i) => i.school_id === where.school_id && (!where.status || i.status === where.status))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0] ?? null,
  );
  prisma.invoice.findUnique.mockImplementation(async ({ where }: any) => invoices.find((i) => i.id === where.id) ?? null);
  prisma.invoice.create.mockImplementation(async ({ data }: any) => {
    if (invoices.some((i) => i.number === data.number)) throw Object.assign(new Error('dup number'), { code: '23505' });
    if (
      data.provider_invoice_id == null &&
      invoices.some((i) => i.school_id === data.school_id && i.status !== 'void' && i.provider_invoice_id == null && i.period_start.getTime() === data.period_start.getTime())
    ) {
      throw Object.assign(new Error('dup period'), { code: '23505' });
    }
    const row = invoiceRow({ ...data, id: `inv-${++ids}` });
    invoices.push(row);
    return row;
  });
  prisma.invoice.update.mockImplementation(async ({ where, data }: any) => {
    const row = invoices.find((i) => i.id === where.id)!;
    Object.assign(row, data);
    return { ...row };
  });
  prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('MAX(')) {
      const prefix = String(values[0]).replace('%', '');
      const seqs = invoices.filter((i) => i.number.startsWith(prefix)).map((i) => Number(i.number.split('-')[2]));
      return [{ seq: seqs.length ? Math.max(...seqs) : null }];
    }
    return [{ locked: '' }];
  });
  prisma.subscription.findUnique.mockImplementation(async ({ where }: any) => subs.get(where.school_id) ?? null);
  prisma.subscription.findMany.mockImplementation(async () => [...subs.values()]);
  prisma.subscription.update.mockImplementation(async ({ where, data }: any) => {
    const row = subs.get(where.school_id)!;
    Object.assign(row, data);
    return { ...row };
  });
  prisma.provider_setting.findMany.mockResolvedValue([]);

  const registry = new BillingRegistry(prisma as never, [new FakeProvider('manual', 'invoice'), new FakeProvider('subp')]);
  const seats = { countBillable: async () => billable };
  const subscriptions = {
    ensure: async (schoolId: string) => subs.get(schoolId)!,
    invalidate: async (schoolId: string) => void invalidated.push(schoolId),
  };
  service = new InvoiceService(prisma as never, registry, seats as never, subscriptions as never);
});

function addSub(over: Partial<Sub> = {}): Sub {
  const row = subRow({ plan: 'per_user', provider: 'manual', trial_ends_at: new Date(NOW.getTime() + 3 * DAY), ...over });
  subs.set(row.school_id, row);
  return row;
}

describe('numbering', () => {
  test('GB-YYYYMM-<seq>', () => {
    expect(numberPrefix(NOW)).toBe('GB-202610-');
    expect(formatNumber(new Date('2027-01-02T00:00:00Z'), 7)).toBe('GB-202701-0007');
  });

  test('sequential within a month, restarting each month', async () => {
    addSub({ school_id: 'a' });
    addSub({ school_id: 'b' });
    addSub({ school_id: 'c' });
    expect((await service.raise(subs.get('a')!, NOW)).invoice.number).toBe('GB-202610-0001');
    expect((await service.raise(subs.get('b')!, NOW)).invoice.number).toBe('GB-202610-0002');
    const nov = new Date('2026-11-02T00:00:00Z');
    expect((await service.raise(subs.get('c')!, nov)).invoice.number).toBe('GB-202611-0001');
  });
});

describe('raise', () => {
  test('prices per seat at issue time, due in 14 days, for the month after the trial', async () => {
    billable = 16;
    const sub = addSub();
    const { invoice, created } = await service.raise(sub, NOW);
    expect(created).toBe(true);
    expect(invoice).toMatchObject({ plan: 'per_user', seats: 16, amount_cents: 8000, currency: 'USD', status: 'open', provider: 'manual' });
    expect(invoice.due_at).toEqual(new Date(NOW.getTime() + 14 * DAY));
    expect(invoice.period_start).toEqual(sub.trial_ends_at);
    expect(invoice.period_end).toEqual(new Date('2026-11-27T12:00:00Z'));
    expect(subs.get('school-1')!.quantity).toBe(16);
  });

  test('flat plan is one seat at the flat price', async () => {
    const { invoice } = await service.raise(addSub({ plan: 'flat' }), NOW);
    expect(invoice).toMatchObject({ seats: 1, amount_cents: 30000 });
  });

  test('returns the open invoice instead of raising another', async () => {
    const sub = addSub();
    const first = await service.raise(sub, NOW);
    const second = await service.raise(sub, new Date(NOW.getTime() + DAY));
    expect(second.created).toBe(false);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(invoices).toHaveLength(1);
  });

  test('a lapsed school is billed from now', async () => {
    const sub = addSub({ trial_ends_at: new Date(NOW.getTime() - 10 * DAY) });
    expect((await service.raise(sub, NOW)).invoice.period_start).toEqual(NOW);
  });
});

describe('sweep', () => {
  test('raises for invoice-mode schools near the end of what they paid for', async () => {
    addSub({ school_id: 'due' }); // trial ends in 3 days
    addSub({ school_id: 'later', trial_ends_at: new Date(NOW.getTime() + 20 * DAY) });
    addSub({ school_id: 'submode', provider: 'subp' });
    addSub({ school_id: 'noplan', plan: null });
    addSub({ school_id: 'canceling', cancel_at_period_end: true });
    addSub({ school_id: 'comped', comp_until: new Date(NOW.getTime() + 60 * DAY) });
    // findMany does not filter in the fake; dueForInvoice must.
    expect(await service.sweep(NOW)).toBe(1);
    expect(invoices.map((i) => i.school_id)).toEqual(['due']);
  });

  test('is idempotent: running it again (same day or month) creates nothing', async () => {
    addSub();
    expect(await service.sweep(NOW)).toBe(1);
    expect(await service.sweep(NOW)).toBe(0);
    expect(await service.sweep(new Date(NOW.getTime() + 2 * DAY))).toBe(0);
    expect(invoices).toHaveLength(1);
  });

  test('a concurrent raise for the same period loses gracefully', async () => {
    const sub = addSub();
    // Another instance inserted this period's invoice between our check and insert.
    const original = prisma.invoice.findFirst.getMockImplementation()!;
    let calls = 0;
    prisma.invoice.findFirst.mockImplementation(async (args: any) => (++calls === 1 ? null : original(args)));
    invoices.push(invoiceRow({ id: 'theirs', school_id: sub.school_id, period_start: sub.trial_ends_at, number: 'GB-202610-0001' }));
    const result = await service.raise(sub, NOW);
    expect(result).toMatchObject({ created: false, invoice: { id: 'theirs' } });
    expect(invoices).toHaveLength(1);
  });

  test('after payment the next invoice is raised for the following month', async () => {
    const sub = addSub();
    const { invoice } = await service.raise(sub, NOW);
    await service.markPaid(invoice.id, { method: 'bank_transfer' }, 'admin-1');
    expect(sub.current_period_end).toEqual(invoice.period_end);
    expect(await service.sweep(NOW)).toBe(0); // paid through late November
    const nearEnd = new Date(invoice.period_end.getTime() - 5 * DAY);
    expect(await service.sweep(nearEnd)).toBe(1);
    const next = invoices[1];
    expect(next.period_start).toEqual(invoice.period_end);
    expect(next.number).toBe('GB-202611-0001');
  });

  test('schools on an invoice provider no longer offered are still invoiced', async () => {
    process.env.PAYMENT_PROVIDERS = 'subp';
    addSub();
    expect(await service.sweep(NOW)).toBe(1);
  });
});

describe('mark paid / void', () => {
  test('mark paid: invoice paid, subscription active through the period', async () => {
    const sub = addSub();
    const { invoice } = await service.raise(sub, NOW);
    const paid = await service.markPaid(invoice.id, { method: 'cheque', reference: 'CHQ-1', note: 'thanks' }, 'admin-1');
    expect(paid).toMatchObject({ status: 'paid', method: 'cheque', reference: 'CHQ-1', note: 'thanks', marked_by: 'admin-1' });
    expect(paid.paid_at).toBeInstanceOf(Date);
    expect(sub.status).toBe('active');
    expect(sub.current_period_start).toEqual(invoice.period_start);
    expect(sub.current_period_end).toEqual(invoice.period_end);
    expect(invalidated).toContain('school-1');
  });

  test('paying late buys a month from now', async () => {
    const sub = addSub();
    invoices.push(invoiceRow({ id: 'old', period_start: new Date('2026-01-01T00:00:00Z'), period_end: new Date('2026-02-01T00:00:00Z') }));
    await service.markPaid('old', { method: 'cash' }, 'admin-1');
    expect(sub.current_period_end!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
  });

  test('cannot mark a void invoice paid, or pay twice', async () => {
    addSub();
    invoices.push(invoiceRow({ id: 'v', status: 'void' }), invoiceRow({ id: 'p', status: 'paid' }));
    await expect(service.markPaid('v', { method: 'cash' }, 'a')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.markPaid('p', { method: 'cash' }, 'a')).rejects.toBeInstanceOf(ConflictException);
  });

  test('void: open -> void; paid or void cannot be voided', async () => {
    addSub();
    invoices.push(invoiceRow({ id: 'o' }), invoiceRow({ id: 'p', status: 'paid' }));
    expect((await service.voidInvoice('o', 'wrong plan')).status).toBe('void');
    await expect(service.voidInvoice('o')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.voidInvoice('p')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.voidInvoice('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a voided invoice frees the period for a replacement', async () => {
    const sub = addSub();
    const { invoice } = await service.raise(sub, NOW);
    await service.voidInvoice(invoice.id);
    const again = await service.raise(sub, NOW);
    expect(again.created).toBe(true);
    expect(again.invoice.number).toBe('GB-202610-0002');
  });

  test('provider payment of an open invoice applies once; a void one is not revived', async () => {
    const sub = addSub();
    const { invoice } = await service.raise(sub, NOW);
    expect(await service.markPaidByProvider(invoice, 'wipay', NOW, 'TXN-1')).toBe(true);
    expect(invoices[0]).toMatchObject({ status: 'paid', method: 'wipay', reference: 'TXN-1' });
    expect(await service.markPaidByProvider(invoices[0], 'wipay', NOW, 'TXN-1')).toBe(false);
    const v = invoiceRow({ id: 'v2', status: 'void' });
    expect(await service.markPaidByProvider(v, 'wipay', NOW, 'TXN-2')).toBe(false);
  });
});
