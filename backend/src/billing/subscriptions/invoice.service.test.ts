import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { invoiceRow } from '@/test/billing-fakes';
import { formatNumber, InvoiceService, invoiceDto, numberPrefix } from './invoice.service';

type Inv = ReturnType<typeof invoiceRow>;

let prisma: MockPrisma;
let invoices: Inv[];
let service: InvoiceService;

/** An in-memory invoice table behind the mock, with the unique number index. */
beforeEach(() => {
  prisma = createMockPrisma();
  invoices = [];
  let ids = 0;
  prisma.invoice.create.mockImplementation(async ({ data }: any) => {
    if (invoices.some((i) => i.number === data.number)) throw Object.assign(new Error('dup number'), { code: '23505' });
    const row = invoiceRow({ ...data, id: `inv-${++ids}` });
    invoices.push(row);
    return row;
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
  service = new InvoiceService(prisma as never);
});

function paid(at: Date, providerInvoiceId: string) {
  const { id: _id, number: _number, created_at: _created, ...rest } = invoiceRow({
    provider_invoice_id: providerInvoiceId,
    paid_at: at,
  });
  return { ...rest, created_at: at };
}

describe('numbering', () => {
  test('GB-YYYYMM-<seq>', () => {
    expect(numberPrefix(new Date('2026-10-24T12:00:00Z'))).toBe('GB-202610-');
    expect(formatNumber(new Date('2027-01-02T00:00:00Z'), 7)).toBe('GB-202701-0007');
  });

  test('sequential within a month, restarting each month, under the advisory lock', async () => {
    const oct = new Date('2026-10-24T12:00:00Z');
    const nov = new Date('2026-11-02T00:00:00Z');
    expect((await service.createNumbered(paid(oct, 'in_a'))).number).toBe('GB-202610-0001');
    expect((await service.createNumbered(paid(oct, 'in_b'))).number).toBe('GB-202610-0002');
    expect((await service.createNumbered(paid(nov, 'in_c'))).number).toBe('GB-202611-0001');
    const lockCalls = prisma.$queryRaw.mock.calls.filter((c: any[]) => c[0].join('?').includes('pg_advisory_xact_lock'));
    expect(lockCalls).toHaveLength(3);
  });
});

describe('invoiceDto', () => {
  test('maps a row to the API shape', () => {
    expect(invoiceDto(invoiceRow() as never)).toMatchObject({
      id: 'inv-1',
      number: 'GB-202610-0001',
      status: 'paid',
      amountCents: 5000,
      paidAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
