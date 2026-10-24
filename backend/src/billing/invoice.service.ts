import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isUniqueViolation } from '@/common/db-values';
import type { invoice } from '@/generated/prisma/client';
import {
  addMonth,
  amountFor,
  DAY_MS,
  isPlan,
  loadBillingConfig,
  seatsFor,
} from './billing.config';
import { BillingRegistry } from './billing.registry';
import { SeatService } from './seat.service';
import { SubscriptionService, type SubscriptionRow } from './subscription.service';
import type { BillingPlan } from './providers/payment-provider';

export type InvoiceRow = invoice;

/** Invoices fall due this long after they are raised. */
export const INVOICE_DUE_DAYS = 14;
/** The sweep raises the next invoice this long before the paid period ends. */
export const INVOICE_LEAD_DAYS = 7;

export type MarkPaidMethod = 'bank_transfer' | 'cheque' | 'cash' | 'other';

/** `GB-YYYYMM-` for the month an invoice is issued in (UTC). */
export function numberPrefix(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `GB-${at.getUTCFullYear()}${month}-`;
}

export function formatNumber(at: Date, seq: number): string {
  return `${numberPrefix(at)}${String(seq).padStart(4, '0')}`;
}

/**
 * Invoices: raised by us for invoice-mode providers (WiPay, manual), and
 * recorded as history for subscription-mode providers when they report a
 * payment.
 *
 * Invoice-mode schools pay one month at a time. The sweep raises the next
 * invoice INVOICE_LEAD_DAYS before the paid-through date (or the trial end),
 * never while one is still open; paying it moves the paid-through date on a
 * month. Numbers are `GB-YYYYMM-<seq>`, sequential per issue month.
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BillingRegistry,
    private readonly seats: SeatService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * Insert an invoice with the next number for its issue month. Numbering
   * takes a transaction-scoped advisory lock so concurrent issuers never pick
   * the same sequence.
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

  /** Where the next invoice-mode period starts: the paid-through date, or now once lapsed. */
  nextPeriodStart(sub: SubscriptionRow, now: Date): Date {
    const covered = sub.current_period_end ?? sub.trial_ends_at;
    return covered && covered.getTime() > now.getTime() ? covered : now;
  }

  /**
   * Raise the school's next invoice now, unless one is already open (then
   * that one is returned). Seats are counted at issue time.
   */
  async raise(
    sub: SubscriptionRow,
    now = new Date(),
  ): Promise<{ invoice: InvoiceRow; created: boolean }> {
    const open = await this.prisma.invoice.findFirst({
      where: { school_id: sub.school_id, status: 'open' },
      orderBy: { created_at: 'asc' },
    });
    if (open) return { invoice: open, created: false };

    const cfg = loadBillingConfig();
    const plan: BillingPlan = isPlan(sub.plan) ? sub.plan : 'per_user';
    const billable = await this.seats.countBillable(sub.school_id);
    const seats = seatsFor(plan, billable);
    const periodStart = this.nextPeriodStart(sub, now);

    try {
      const created = await this.createNumbered({
        school_id: sub.school_id,
        plan,
        seats,
        amount_cents: amountFor(cfg, plan, billable),
        currency: cfg.currency,
        status: 'open',
        provider: sub.provider,
        provider_invoice_id: null,
        period_start: periodStart,
        period_end: addMonth(periodStart),
        due_at: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS),
        paid_at: null,
        method: null,
        reference: null,
        note: null,
        marked_by: null,
        created_at: now,
      });
      await this.prisma.subscription.update({
        where: { school_id: sub.school_id },
        data: { quantity: seats, updated_at: now },
      });
      await this.subscriptions.invalidate(sub.school_id);
      return { invoice: created, created: true };
    } catch (err) {
      // Another instance raised this period's invoice a moment ago.
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.prisma.invoice.findFirst({
        where: { school_id: sub.school_id, status: 'open' },
        orderBy: { created_at: 'asc' },
      });
      if (!raced) throw err;
      return { invoice: raced, created: false };
    }
  }

  /** Is this subscription due an invoice from the sweep? */
  dueForInvoice(sub: SubscriptionRow, now: Date): boolean {
    if (!sub.plan || sub.cancel_at_period_end) return false;
    if (this.registry.find(sub.provider)?.mode !== 'invoice') return false;
    const lead = INVOICE_LEAD_DAYS * DAY_MS;
    if (sub.comp_until && sub.comp_until.getTime() - now.getTime() > lead) {
      return false;
    }
    const covered = sub.current_period_end ?? sub.trial_ends_at;
    return !covered || covered.getTime() - now.getTime() <= lead;
  }

  /** The invoice sweep: daily and on demand. Returns how many were raised. */
  async sweep(now = new Date()): Promise<number> {
    const invoiceProviders = (await this.registry.statuses())
      .filter((p) => p.mode === 'invoice')
      .map((p) => p.id);
    if (invoiceProviders.length === 0) return 0;

    const subs = await this.prisma.subscription.findMany({
      where: {
        provider: { in: invoiceProviders },
        plan: { not: null },
        cancel_at_period_end: false,
      },
    });
    let created = 0;
    for (const sub of subs) {
      if (!this.dueForInvoice(sub, now)) continue;
      try {
        const result = await this.raise(sub, now);
        if (result.created) created++;
      } catch (err) {
        this.logger.error(
          `Invoice for school ${sub.school_id} failed: ${(err as Error).message}`,
        );
      }
    }
    return created;
  }

  /**
   * A paid invoice of ours: the subscription becomes active through the
   * invoice's period (a late payment buys a month from now instead).
   */
  async applyPaid(inv: InvoiceRow, now = new Date()): Promise<void> {
    const sub = await this.subscriptions.ensure(inv.school_id, now);
    let start = inv.period_start;
    let end = inv.period_end;
    if (end.getTime() <= now.getTime()) {
      start = now;
      end = addMonth(now);
    }
    const currentEnd = sub.current_period_end;
    const newEnd = currentEnd && currentEnd.getTime() > end.getTime() ? currentEnd : end;
    await this.prisma.subscription.update({
      where: { school_id: inv.school_id },
      data: {
        status: 'active',
        current_period_start: start,
        current_period_end: newEnd,
        updated_at: now,
      },
    });
    await this.subscriptions.invalidate(inv.school_id);
  }

  /** Paid through a provider (WiPay callback, or an invoice.paid with our id). */
  async markPaidByProvider(
    inv: InvoiceRow,
    providerId: string,
    paidAt: Date,
    reference: string | null,
  ): Promise<boolean> {
    if (inv.status === 'paid') return false;
    if (inv.status === 'void') {
      this.logger.error(
        `Payment via ${providerId} for void invoice ${inv.number} (${reference ?? 'no reference'}) - refund or reissue by hand`,
      );
      return false;
    }
    const updated = await this.prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'paid',
        paid_at: paidAt,
        method: providerId,
        reference: reference ?? inv.reference,
      },
    });
    await this.applyPaid(updated);
    return true;
  }

  async find(id: string): Promise<InvoiceRow> {
    const inv = await this.prisma.invoice
      .findUnique({ where: { id } })
      .catch(() => null);
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  /** A platform admin records a payment received outside any provider. */
  async markPaid(
    id: string,
    input: { method: MarkPaidMethod; reference?: string; note?: string },
    adminUserId: string,
  ): Promise<InvoiceRow> {
    const inv = await this.find(id);
    if (inv.status === 'paid') throw new ConflictException('Invoice is already paid');
    if (inv.status === 'void') {
      throw new ConflictException('A void invoice cannot be marked paid');
    }
    const now = new Date();
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'paid',
        paid_at: now,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? inv.note,
        marked_by: adminUserId,
      },
    });
    await this.applyPaid(updated, now);
    return updated;
  }

  async voidInvoice(id: string, note?: string): Promise<InvoiceRow> {
    const inv = await this.find(id);
    if (inv.status === 'paid') throw new ConflictException('A paid invoice cannot be voided');
    if (inv.status === 'void') throw new ConflictException('Invoice is already void');
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'void', note: note ?? inv.note },
    });
    await this.subscriptions.invalidate(inv.school_id);
    return updated;
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
