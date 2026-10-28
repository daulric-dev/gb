import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isUniqueViolation } from '@/common/db-values';
import type { Prisma } from '@/generated/prisma/client';
import { isPlan } from '../config/billing.config';
import { InvoiceService } from '../subscriptions/invoice.service';
import { SubscriptionService, type SubscriptionRow } from '../subscriptions/subscription.service';
import type {
  BillingEvent,
  BillingPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '../providers/payment-provider';

type Ev<T extends BillingEvent['type']> = Extract<BillingEvent, { type: T }>;

/** payment_event id that records a refused duplicate subscription. */
const refusedMarker = (providerSubscriptionId: string) => `duplicate:${providerSubscriptionId}`;

const LIVE = new Set(['active', 'trialing', 'past_due']);

/** Statuses whose current period was not paid for. */
const UNPAID = new Set(['past_due', 'unpaid', 'incomplete']);

/** A subscription's state, from the provider or (as a fallback) the event. */
interface SubscriptionState {
  providerSubscriptionId: string;
  providerCustomerId?: string | null;
  status: SubscriptionStatus;
  plan?: BillingPlan | null;
  quantity?: number | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

/** What applyState needs to know about the event that led to it. */
interface EventInfo {
  type: string;
  eventId: string;
  occurredAt?: Date | null;
}

/**
 * Another worker is applying the same event right now. The webhook answers
 * 409 so the provider retries later; the retry is then a no-op duplicate.
 */
export class EventInProgressError extends Error {
  constructor(eventId: string) {
    super(`Event ${eventId} is being processed by another worker`);
    this.name = 'EventInProgressError';
  }
}

/**
 * Applies normalised provider events to subscription and invoice rows.
 *
 * Each event is recorded in billing.payment_event under (provider, eventId)
 * first; one already processed is skipped, so provider retries and
 * duplicate deliveries are harmless. Before applying, a worker claims the row
 * (processing_at) with one conditional UPDATE, so two concurrent deliveries
 * cannot both apply it; the loser throws EventInProgressError (409, retried).
 * A failure is written to the row, the claim released, and the error
 * rethrown - the webhook answers 500 and the provider retries.
 *
 * Providers do not promise delivery order. An event created before the
 * newest one applied to the subscription (last_event_at) is ignored. For
 * subscription-affecting events the current subscription is fetched from the
 * provider (getSubscription) and that state applied, so neither a late event
 * nor checkout.session.completed / invoice.paid can force an outdated
 * status. Without getSubscription the event's own data is applied, guarded by
 * the period end, and a canceled subscription is not revived.
 *
 * A school holds one live subscription. A second live one (two checkouts
 * that raced) is canceled at the provider instead of replacing the first,
 * and its payment refunded - now, or on its invoice.paid if not paid yet.
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
        // A concurrent delivery of the same event recorded it first; the
        // claim below decides which of us applies it.
        row = await this.prisma.payment_event.findUnique({
          where: { provider_event_id: key },
        });
        if (!row) throw err;
        if (row.processed_at) return false;
      }
    }

    if (!(await this.claim(row.id))) {
      throw new EventInProgressError(event.eventId);
    }

    try {
      const schoolId = await this.apply(provider, event);
      await this.prisma.payment_event.update({
        where: { id: row.id },
        data: {
          processed_at: new Date(),
          processing_at: null,
          error: null,
          school_id: schoolId,
        },
      });
      await this.subscriptions.invalidate(schoolId);
      return true;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      await this.prisma.payment_event
        .update({
          where: { id: row.id },
          data: { error: message.slice(0, 2000), processing_at: null },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Claim an unprocessed event for this worker. Atomic: of concurrent
   * claimers exactly one updates the row. A claim older than 5 minutes
   * belongs to a worker that died and may be taken over.
   */
  private async claim(id: string): Promise<boolean> {
    const claimed = await this.prisma.$executeRaw`
      UPDATE billing.payment_event
         SET processing_at = now()
       WHERE id = ${id}::uuid
         AND processed_at IS NULL
         AND (processing_at IS NULL OR processing_at < now() - interval '5 minutes')`;
    return claimed > 0;
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

  /** Whether the row already holds a newer event of this same subscription. */
  private stale(
    provider: PaymentProvider,
    sub: SubscriptionRow,
    providerSubscriptionId: string | null | undefined,
    occurredAt: Date | null | undefined,
  ): boolean {
    return (
      sub.provider === provider.id &&
      !!providerSubscriptionId &&
      sub.provider_subscription_id === providerSubscriptionId &&
      !!sub.last_event_at &&
      !!occurredAt &&
      occurredAt.getTime() < sub.last_event_at.getTime()
    );
  }

  /** last_event_at after applying an event: never moves back. */
  private lastEventAt(
    sub: SubscriptionRow,
    sameSub: boolean,
    occurredAt: Date | null | undefined,
  ): { last_event_at?: Date } {
    if (!occurredAt) return {};
    const held = sameSub ? sub.last_event_at : null;
    return !held || occurredAt > held ? { last_event_at: occurredAt } : {};
  }

  /** The provider's current state of a subscription, else `fallback`. */
  private async current(
    provider: PaymentProvider,
    providerSubscriptionId: string,
    fallback: SubscriptionState | null,
  ): Promise<SubscriptionState | null> {
    if (!provider.getSubscription) return fallback;
    return (await provider.getSubscription(providerSubscriptionId)) ?? fallback;
  }

  private async subscriptionUpdated(
    provider: PaymentProvider,
    e: Ev<'subscription.updated'>,
  ): Promise<string | null> {
    const sub = await this.locate(provider, e.providerSubscriptionId, e.schoolId);
    if (!sub) return this.unknown(provider, e);

    if (this.stale(provider, sub, e.providerSubscriptionId, e.occurredAt)) {
      this.logger.log(`Stale ${e.type} ${e.eventId} for school ${sub.school_id} - ignored`);
      return sub.school_id;
    }
    const state = await this.current(provider, e.providerSubscriptionId, e);
    return this.applyState(provider, sub, state ?? e, e);
  }

  /** Write a subscription's state to the school's row, unless it must not. */
  private async applyState(
    provider: PaymentProvider,
    sub: SubscriptionRow,
    s: SubscriptionState,
    e: EventInfo,
  ): Promise<string> {
    const sameSub =
      sub.provider === provider.id &&
      sub.provider_subscription_id === s.providerSubscriptionId;

    if (sameSub) {
      const held = sub.current_period_end?.getTime();
      const incoming = s.currentPeriodEnd?.getTime();
      if (held !== undefined && incoming !== undefined && incoming < held) {
        this.logger.log(`Stale ${e.type} ${e.eventId} for school ${sub.school_id} - ignored`);
        return sub.school_id;
      }
      if (
        sub.status === 'canceled' &&
        s.status !== 'canceled' &&
        !(held !== undefined && incoming !== undefined && incoming > held)
      ) {
        this.logger.log(`${e.type} ${e.eventId} after cancellation - ignored`);
        return sub.school_id;
      }
    } else if (sub.provider_subscription_id && LIVE.has(sub.status)) {
      if (!LIVE.has(s.status)) {
        // The school has another live subscription; news that an older one
        // ended or never completed does not touch it.
        this.logger.log(
          `${e.type} ${e.eventId} for superseded subscription ${s.providerSubscriptionId} - ignored`,
        );
        return sub.school_id;
      }
      if (sub.provider === provider.id && (await this.heldIsLive(provider, sub))) {
        await this.refuseDuplicate(provider, sub, s, e);
        return sub.school_id;
      }
    }

    // A subscription canceled while its current period is unpaid is paid
    // through the start of that period only (see computeEntitlement); one
    // already canceled keeps the paid-through date it has.
    let period: { current_period_start?: Date; current_period_end?: Date | null };
    if (sameSub && s.status === 'canceled' && sub.status === 'canceled') {
      period = {};
    } else if (sameSub && s.status === 'canceled' && UNPAID.has(sub.status)) {
      period = { current_period_end: this.paidThrough(sub) };
    } else {
      period = {
        ...(s.currentPeriodStart ? { current_period_start: s.currentPeriodStart } : {}),
        ...(s.currentPeriodEnd ? { current_period_end: s.currentPeriodEnd } : {}),
      };
    }

    await this.prisma.subscription.update({
      where: { school_id: sub.school_id },
      data: {
        provider: provider.id,
        provider_subscription_id: s.providerSubscriptionId,
        ...(s.providerCustomerId ? { provider_customer_id: s.providerCustomerId } : {}),
        status: s.status,
        ...(isPlan(s.plan) ? { plan: s.plan } : {}),
        ...(s.quantity && s.quantity >= 1 ? { quantity: s.quantity } : {}),
        ...period,
        ...(s.cancelAtPeriodEnd !== undefined
          ? { cancel_at_period_end: s.cancelAtPeriodEnd }
          : {}),
        ...this.lastEventAt(sub, sameSub, e.occurredAt),
        // The checkout this subscription came from is done.
        pending_checkout_id: null,
        updated_at: new Date(),
      },
    });
    return sub.school_id;
  }

  /** Paid-through date of a row whose current period went unpaid. */
  private paidThrough(sub: SubscriptionRow): Date | null {
    const start = sub.current_period_start;
    const end = sub.current_period_end;
    if (start && (!end || start < end)) return start;
    return end ?? null;
  }

  /** Whether the subscription the row holds is still live at the provider. */
  private async heldIsLive(provider: PaymentProvider, sub: SubscriptionRow): Promise<boolean> {
    if (!provider.getSubscription || !sub.provider_subscription_id) return true;
    const held = await provider.getSubscription(sub.provider_subscription_id);
    return !!held && LIVE.has(held.status);
  }

  /**
   * A second live subscription for a school that already has one (two
   * checkouts raced): cancel it at the provider rather than replace the
   * first, which would leave the first billing unseen, and refund what it
   * charged. The refusal is recorded first (refusedMarker) so an invoice.paid
   * for it that arrives later - its first invoice may not be paid yet - is
   * refunded too. A refund that fails is logged as an error for an operator
   * to refund by hand; it does not fail the event.
   */
  private async refuseDuplicate(
    provider: PaymentProvider,
    sub: SubscriptionRow,
    s: SubscriptionState,
    e: EventInfo,
  ): Promise<void> {
    this.logger.warn(
      `School ${sub.school_id} already has live subscription ${sub.provider_subscription_id}; ` +
        `canceling and refunding duplicate ${s.providerSubscriptionId} (${e.type} ${e.eventId})`,
    );
    await this.markRefused(provider, sub, s.providerSubscriptionId, e);
    if (!provider.cancel) {
      this.logger.error(
        `${provider.id} cannot cancel; cancel duplicate subscription ${s.providerSubscriptionId} ` +
          `of school ${sub.school_id} by hand`,
      );
    } else {
      await provider.cancel(
        {
          providerSubscriptionId: s.providerSubscriptionId,
          providerCustomerId: s.providerCustomerId ?? null,
          plan: isPlan(s.plan) ? s.plan : 'per_user',
        },
        { atPeriodEnd: false },
      );
    }
    await this.refundDuplicate(provider, sub.school_id, s.providerSubscriptionId);
  }

  /**
   * Remember a refused subscription. Kept as a processed row in
   * payment_event (event id `duplicate:<subscription id>`), which already
   * has the (provider, event id) key this lookup needs.
   */
  private async markRefused(
    provider: PaymentProvider,
    sub: SubscriptionRow,
    providerSubscriptionId: string,
    e: EventInfo,
  ): Promise<void> {
    try {
      await this.prisma.payment_event.create({
        data: {
          provider: provider.id,
          event_id: refusedMarker(providerSubscriptionId),
          type: 'subscription.duplicate_refused',
          school_id: sub.school_id,
          payload: {
            providerSubscriptionId,
            heldSubscriptionId: sub.provider_subscription_id,
            eventId: e.eventId,
          },
          processed_at: new Date(),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  /** The refusal recorded for a subscription, or null. */
  private async refusal(
    provider: PaymentProvider,
    providerSubscriptionId: string,
  ): Promise<{ school_id: string | null } | null> {
    return this.prisma.payment_event.findUnique({
      where: {
        provider_event_id: {
          provider: provider.id,
          event_id: refusedMarker(providerSubscriptionId),
        },
      },
      select: { school_id: true },
    });
  }

  /** Refund a refused subscription's latest payment, if it has one yet. */
  private async refundDuplicate(
    provider: PaymentProvider,
    schoolId: string,
    providerSubscriptionId: string,
  ): Promise<void> {
    if (!provider.refundLatestPayment) {
      this.logger.error(
        `${provider.id} cannot refund; refund duplicate subscription ${providerSubscriptionId} ` +
          `of school ${schoolId} by hand if it was charged`,
      );
      return;
    }
    try {
      const refund = await provider.refundLatestPayment(providerSubscriptionId);
      if (refund) {
        this.logger.warn(
          `Refunded ${refund.amountCents} ${refund.currency} of invoice ${refund.providerInvoiceId} ` +
            `(refunds ${refund.refundIds.join(', ') || 'already made'}) for duplicate subscription ` +
            `${providerSubscriptionId} of school ${schoolId}`,
        );
      } else {
        this.logger.warn(
          `Duplicate subscription ${providerSubscriptionId} of school ${schoolId} has no paid ` +
            `invoice yet - it is refunded when its invoice.paid arrives`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Refund of duplicate subscription ${providerSubscriptionId} of school ${schoolId} failed: ` +
          `${(err as Error).message} - refund it by hand`,
      );
    }
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
    // Ending is final, so it applies whatever its order. A period that was
    // never paid does not stay writable to its end.
    await this.prisma.subscription.update({
      where: { school_id: sub.school_id },
      data: {
        status: 'canceled',
        cancel_at_period_end: false,
        ...(UNPAID.has(sub.status) ? { current_period_end: this.paidThrough(sub) } : {}),
        ...this.lastEventAt(sub, true, e.occurredAt),
        updated_at: new Date(),
      },
    });
    return sub.school_id;
  }

  private async invoicePaid(
    provider: PaymentProvider,
    e: Ev<'invoice.paid'>,
  ): Promise<string | null> {
    // A payment for a duplicate subscription refused earlier (its first
    // invoice was paid after the refusal): refund it, keep no history.
    const refused = e.providerSubscriptionId
      ? await this.refusal(provider, e.providerSubscriptionId)
      : null;
    if (refused && e.providerSubscriptionId) {
      await this.refundDuplicate(provider, refused.school_id ?? 'unknown', e.providerSubscriptionId);
      return refused.school_id;
    }

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
    if (!sameSub) return sub.school_id;
    if (this.stale(provider, sub, e.providerSubscriptionId, e.occurredAt)) {
      return sub.school_id;
    }

    // The provider's current state, not "active": a later failure,
    // cancellation or period may already have happened.
    if (e.providerSubscriptionId && provider.getSubscription) {
      const state = await this.current(provider, e.providerSubscriptionId, null);
      if (state) return this.applyState(provider, sub, state, e);
    }

    if (sub.status !== 'canceled') {
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
          ...this.lastEventAt(sub, true, e.occurredAt),
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
    if (!sameSub || this.stale(provider, sub, e.providerSubscriptionId, e.occurredAt)) {
      return sub.school_id;
    }

    if (e.providerSubscriptionId && provider.getSubscription) {
      const state = await this.current(provider, e.providerSubscriptionId, null);
      if (state) return this.applyState(provider, sub, state, e);
    }

    if (sub.status === 'active') {
      await this.prisma.subscription.update({
        where: { school_id: sub.school_id },
        data: {
          status: 'past_due',
          ...this.lastEventAt(sub, true, e.occurredAt),
          updated_at: new Date(),
        },
      });
    }
    return sub.school_id;
  }
}
