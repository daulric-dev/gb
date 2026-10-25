import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { invoice } from '@/generated/prisma/client';

export type InvoiceRow = invoice;

/** `GB-YYYYMM-` for the month an invoice is issued in (UTC). */
export function numberPrefix(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `GB-${at.getUTCFullYear()}${month}-`;
}

export function formatNumber(at: Date, seq: number): string {
  return `${numberPrefix(at)}${String(seq).padStart(4, '0')}`;
}

/**
 * The school's invoice history. The payment provider (Stripe) owns the real
 * invoices and collects them; when it reports one paid (`invoice.paid`) we
 * keep a copy here, numbered `GB-YYYYMM-<seq>` per issue month, so school
 * admins and platform admins can see what was billed. The provider's own
 * invoice and PDF are in its customer portal.
 */
@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert an invoice with the next number for its issue month. Numbering
   * takes a transaction-scoped advisory lock so concurrent webhooks never
   * pick the same sequence.
   */
  async createNumbered(
    data: Omit<InvoiceRow, 'id' | 'number' | 'created_at'> & { created_at?: Date },
  ): Promise<InvoiceRow> {
    const issuedAt = data.created_at ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('gradebook:billing:invoice-number'))::text AS locked`;
      const prefix = numberPrefix(issuedAt);
      const rows = await tx.$queryRaw<Array<{ seq: number | null }>>`
        SELECT MAX(split_part(number, '-', 3)::int) AS seq
          FROM billing.invoice
         WHERE number LIKE ${`${prefix}%`}`;
      const seq = Number(rows?.[0]?.seq ?? 0) + 1;
      return tx.invoice.create({
        data: { ...data, created_at: issuedAt, number: formatNumber(issuedAt, seq) },
      });
    });
  }
}

export function invoiceDto(inv: InvoiceRow) {
  return {
    id: inv.id,
    number: inv.number,
    plan: inv.plan,
    seats: inv.seats,
    amountCents: inv.amount_cents,
    currency: inv.currency,
    status: inv.status,
    provider: inv.provider,
    periodStart: inv.period_start.toISOString(),
    periodEnd: inv.period_end.toISOString(),
    dueAt: inv.due_at.toISOString(),
    paidAt: inv.paid_at?.toISOString() ?? null,
    method: inv.method,
  };
}
