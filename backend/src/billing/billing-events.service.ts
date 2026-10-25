import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isUniqueViolation } from '@/common/db-values';
import type { Prisma } from '@/generated/prisma/client';
import { isPlan } from './billing.config';
import { InvoiceService } from './invoice.service';
import { SubscriptionService, type SubscriptionRow } from './subscription.service';
import type { BillingEvent, PaymentProvider } from './providers/payment-provider';

type Ev<T extends BillingEvent['type']> = Extract<BillingEvent, { type: T }>;

const LIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * Applies normalised provider events to subscription and invoice rows.
 *
 * Each event is recorded in billing.payment_event under (provider, eventId)
 * first; one already processed is skipped, so provider retries and
 * duplicate deliveries are harmless. A failure is written to the row and
 * rethrown - the webhook answers 500 and the provider retries.
 *
 * Providers do not promise delivery order. A subscription.updated whose
 * period ends before the one we already hold is stale and ignored, and a
 * canceled subscription is not revived by an older update.
 */
@Injectable()
export class BillingEventsService {
  private readonly logger = new Logger(BillingEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly invoices: InvoiceService,
  ) {}

  /** Returns how many events were newly applied (duplicates excluded). */
  async handle(provider: PaymentProvider, events: BillingEvent[]): Promise<number> {
    let applied = 0;
    for (const event of events) {
      if (await this.handleOne(provider, event)) applied++;
    }
    return applied;
  }

  private async handleOne(provider: PaymentProvider, event: BillingEvent): Promise<boolean> {
    if (!event.eventId) {
      throw new Error(`${provider.id} produced an event without an id`);
    }
    const key = { provider: provider.id, event_id: event.eventId };
    let row = await this.prisma.payment_event.findUnique({
      where: { provider_event_id: key },
    });
    if (row?.processed_at) return false;

    if (!row) {
      try {
        row = await this.prisma.payment_event.create({
          data: {
            ...key,
            type: event.type,
            payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // A concurrent delivery of the same event got here first.
        return false;
      }
    }

    try {
      const schoolId = await this.apply(provider, event);
      await this.prisma.payment_event.update({
        where: { id: row.id },
        data: { processed_at: new Date(), error: null, school_id: schoolId },
      });
      await this.subscriptions.invalidate(schoolId);
      return true;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      await this.prisma.payment_event
        .update({ where: { id: row.id }, data: { error: message.slice(0, 2000) } })
        .catch(() => undefined);
      throw err;
    }
  }

  /** Apply one event; returns the school it concerned, or null. */
  async apply(provider: PaymentProvider, event: BillingEvent): Promise<string | null> {
    switch (event.type) {
      case 'ignored':
        return null;
      case 'subscription.updated':
        return this.subscriptionUpdated(provider, event);
      case 'subscription.canceled':
        return this.subscriptionCanceled(provider, event);
      case 'invoice.paid':
        return this.invoicePaid(provider, event);
      case 'invoice.payment_failed':
        return this.paymentFailed(provider, event);
      default:
        return null;
    }
  }

  /** The school's row, by the provider's subscription id or the school id we attached. */
  private async locate(
    provider: PaymentProvider,
    providerSubscriptionId: string | null | undefined,
    schoolId: string | null | undefined,
  ): Promise<SubscriptionRow | null> {
    if (providerSubscriptionId) {
      const bySub = await this.prisma.subscription.findFirst({
        where: { provider: provider.id, provider_subscription_id: providerSubscriptionId },
      });
      if (bySub) return bySub;
    }
    if (schoolId) {
      const school = await this.prisma.school
        .findUnique({ where: { id: schoolId }, select: { id: true } })
        .catch(() => null);
      if (school) return this.subscriptions.ensure(school.id);
    }
    return null;
  }

  private unknown(provider: PaymentProvider, event: BillingEvent): null {
    this.logger.warn(
      `${provider.id} ${event.type} ${event.eventId}: no matching school - ignored`,
    );
    return null;
  }

  private async subscriptionUpdated(
    provider: PaymentProvider,
    e: Ev<'subscription.updated'>,
  ): Promise<string | null> {
    const sub = await this.locate(provider, e.providerSubscriptionId, e.schoolId);
    if (!sub) return this.unknown(provider, e);

    const sameSub =
      sub.provider === provider.id &&
      sub.provider_subscription_id === e.providerSubscriptionId;

    if (sameSub) {
      const held = sub.current_period_end?.getTime();
      const incoming = e.currentPeriodEnd?.getTime();
      if (held !== undefined && incoming !== undefined && incoming < held) {
        this.logger.log(`Stale ${e.type} ${e.eventId} for school ${sub.school_id} - ignored`);
        return sub.school_id;
      }
      if (
        sub.status === 'canceled' &&
        e.status !== 'canceled' &&
        !(held !== undefined && incoming !== undefined && incoming > held)
      ) {
        this.logger.log(`${e.type} ${e.eventId} after cancellation - ignored`);
        return sub.school_id;
      }
    } else if (
      sub.provider_subscription_id &&
      LIVE.has(sub.status) &&
      !LIVE.has(e.status)
    ) {
      // The school has another live subscription; news that an older one
      // ended or never completed does not touch it.
      this.logger.log(
        `${e.type} ${e.eventId} for superseded subscription ${e.providerSubscriptionId} - ignored`,
      );
      return sub.school_id;
    }

    await this.prisma.subscription.update({
      where: { school_id: sub.school_id },
      data: {
        provider: provider.id,
        provider_subscription_id: e.providerSubscriptionId,
        ...(e.providerCustomerId ? { provider_customer_id: e.providerCustomerId } : {}),
        status: e.status,
        ...(isPlan(e.plan) ? { plan: e.plan } : {}),
        ...(e.quantity && e.quantity >= 1 ? { quantity: e.quantity } : {}),
        ...(e.currentPeriodStart ? { current_period_start: e.currentPeriodStart } : {}),
        ...(e.currentPeriodEnd ? { current_period_end: e.currentPeriodEnd } : {}),
        ...(e.cancelAtPeriodEnd !== undefined
          ? { cancel_at_period_end: e.cancelAtPeriodEnd }
          : {}),
        updated_at: new Date(),
      },
    });
    return sub.school_id;
  }

  private async subscriptionCanceled(
    provider: PaymentProvider,
    e: Ev<'subscription.canceled'>,
  ): Promise<string | null> {
    const sub = await this.locate(provider, e.providerSubscriptionId, e.schoolId);
    if (!sub) return this.unknown(provider, e);
    if (
      sub.provider !== provider.id ||
      sub.provider_subscription_id !== e.providerSubscriptionId
    ) {
      // An old subscription of a school that has since moved on.
      return sub.school_id;
    }
    await this.prisma.subscription.update({
      where: { school_id: sub.school_id },
      data: { status: 'canceled', cancel_at_period_end: false, updated_at: new Date() },
    });
    return sub.school_id;
  }

  private async invoicePaid(
    provider: PaymentProvider,
    e: Ev<'invoice.paid'>,
  ): Promise<string | null> {
    // The provider billed a period; keep it as history.
    const sub = await this.locate(provider, e.providerSubscriptionId, e.schoolId);
    if (!sub) return this.unknown(provider, e);

    if (e.providerInvoiceId) {
      const existing = await this.prisma.invoice.findUnique({
        where: {
          provider_provider_invoice_id: {
            provider: provider.id,
            provider_invoice_id: e.providerInvoiceId,
          },
        },
      });
      if (!existing) {
        await this.invoices.createNumbered({
          school_id: sub.school_id,
          plan: isPlan(sub.plan) ? sub.plan : 'per_user',
          seats: Math.max(1, sub.quantity),
          amount_cents: e.amountCents,
          currency: e.currency.toUpperCase(),
          status: 'paid',
          provider: provider.id,
          provider_invoice_id: e.providerInvoiceId,
          period_start: e.periodStart ?? sub.current_period_start ?? e.paidAt,
          period_end: e.periodEnd ?? sub.current_period_end ?? e.paidAt,
          due_at: e.paidAt,
          paid_at: e.paidAt,
          method: provider.id,
          reference: null,
          note: null,
          marked_by: null,
        });
      }
    }

    const sameSub =
      !e.providerSubscriptionId ||
      (sub.provider === provider.id &&
        sub.provider_subscription_id === e.providerSubscriptionId);
    if (sameSub && sub.status !== 'canceled') {
      const end =
        e.periodEnd && (!sub.current_period_end || e.periodEnd > sub.current_period_end)
          ? e.periodEnd
          : null;
      await this.prisma.subscription.update({
        where: { school_id: sub.school_id },
        data: {
          status: 'active',
          ...(end
            ? { current_period_end: end, current_period_start: e.periodStart ?? undefined }
            : {}),
          updated_at: new Date(),
        },
      });
    }
    return sub.school_id;
  }

  private async paymentFailed(
    provider: PaymentProvider,
    e: Ev<'invoice.payment_failed'>,
  ): Promise<string | null> {
    const sub = await this.locate(provider, e.providerSubscriptionId, e.schoolId);
    if (!sub) return this.unknown(provider, e);
    const sameSub =
      sub.provider === provider.id &&
      (!e.providerSubscriptionId || sub.provider_subscription_id === e.providerSubscriptionId);
    if (sameSub && sub.status === 'active') {
      await this.prisma.subscription.update({
        where: { school_id: sub.school_id },
        data: { status: 'past_due', updated_at: new Date() },
      });
    }
    return sub.school_id;
  }
}
