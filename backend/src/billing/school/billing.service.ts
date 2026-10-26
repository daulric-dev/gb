import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  amountFor,
  billingEnabled,
  billingReturnUrl,
  loadBillingConfig,
  planPrice,
  seatsFor,
} from '../config/billing.config';
import { BillingRegistry, info } from '../providers/billing.registry';
import { ProviderApiError } from '../providers/http';
import { invoiceDto } from '../subscriptions/invoice.service';
import { SeatService } from '../subscriptions/seat.service';
import { SubscriptionService, type SubscriptionRow } from '../subscriptions/subscription.service';
import type {
  BillingPlan,
  CheckoutResult,
  PaymentProvider,
  ProviderSubscriptionRef,
} from '../providers/payment-provider';

export interface Caller {
  id: string;
  email?: string;
}

export interface PayResult {
  redirectUrl: string | null;
}

const LIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * The checkout transaction holds the school's row lock across one or two
 * provider calls (expire the old session, create the new one), each normally
 * well under a second. A second checkout waits for the lock at most 10s
 * (lock_timeout, then 409).
 */
const CHECKOUT_TX_TIMEOUT_MS = 30_000;
const CHECKOUT_TX_MAX_WAIT_MS = 5_000;

/**
 * The provider idempotency key for a checkout: the school, provider, plan
 * and seats, plus the row state it was started from (the pending session it
 * replaces and the row's updated_at, which every checkout and webhook
 * write moves). Two attempts from the same state share a key, so the
 * provider returns one session (or refuses the second if, e.g., the email
 * differs); the next checkout starts from a new state and gets a new key.
 */
export function checkoutKey(
  sub: Pick<SubscriptionRow, 'school_id' | 'pending_checkout_id' | 'updated_at'>,
  providerId: string,
  plan: BillingPlan,
  quantity: number,
): string {
  const state = [
    sub.school_id,
    providerId,
    plan,
    quantity,
    sub.pending_checkout_id ?? '-',
    sub.updated_at.toISOString(),
  ].join('|');
  return `gradebook-checkout-${createHash('sha256').update(state).digest('hex').slice(0, 40)}`;
}

/** Postgres lock_not_available (55P03): the lock timeout ran out. */
function isLockTimeout(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  return (
    e?.code === '55P03' ||
    e?.meta?.code === '55P03' ||
    /lock timeout/i.test(e?.message ?? '')
  );
}

export const PAYMENTS_NOT_CONFIGURED =
  'Payments are not configured yet - please contact support';

/** School-side billing: what a school admin sees and does. */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BillingRegistry,
    private readonly subscriptions: SubscriptionService,
    private readonly seats: SeatService,
  ) {}

  /** GET /billing/status - any signed-in user; answers even when billing is off. */
  async status(userId: string) {
    if (!billingEnabled()) {
      return { enabled: false, readOnly: false, status: null, trialEndsAt: null };
    }
    const schoolId = await this.subscriptions.schoolOfUser(userId);
    if (!schoolId) {
      return { enabled: true, readOnly: false, status: null, trialEndsAt: null };
    }
    const ent = await this.subscriptions.entitlement(schoolId);
    return {
      enabled: true,
      readOnly: ent.readOnly,
      status: ent.status,
      trialEndsAt: ent.trialEndsAt,
    };
  }

  /** The admin's school; PermissionGuard already checked school:update there. */
  async adminSchool(userId: string): Promise<{ id: string; name: string }> {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true },
    });
    if (!profile?.school_id) {
      throw new ForbiddenException('You are not assigned to a school');
    }
    const school = await this.prisma.school.findUnique({
      where: { id: profile.school_id },
      select: { id: true, name: true },
    });
    if (!school) throw new NotFoundException('School not found');
    return { id: school.id, name: school.name ?? 'School' };
  }

  async summary(userId: string) {
    const school = await this.adminSchool(userId);
    return this.summaryFor(school.id);
  }

  async summaryFor(schoolId: string) {
    const cfg = loadBillingConfig();
    const sub = await this.subscriptions.ensure(schoolId);
    const billableUsers = await this.seats.countBillable(schoolId);
    const enabled = this.registry.enabled();
    const ent = this.subscriptions.evaluate(sub);
    const plan = (sub.plan as BillingPlan | null) ?? null;
    return {
      enabled: true,
      plan,
      status: ent.status,
      readOnly: ent.readOnly,
      trialEndsAt: sub.trial_ends_at?.toISOString() ?? null,
      currentPeriodEnd: sub.current_period_end?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      provider: sub.provider,
      billableUsers,
      estimatedAmountCents: amountFor(cfg, plan ?? 'per_user', billableUsers),
      currency: cfg.currency,
      prices: { perUserCents: cfg.perUserCents, flatCents: cfg.flatCents },
      providers: enabled.map(info),
      paymentsConfigured: enabled.length > 0,
    };
  }

  private ref(sub: SubscriptionRow): ProviderSubscriptionRef | null {
    if (!sub.provider_subscription_id || !sub.plan) return null;
    return {
      providerSubscriptionId: sub.provider_subscription_id,
      providerCustomerId: sub.provider_customer_id,
      plan: sub.plan as BillingPlan,
    };
  }

  /**
   * The provider to check out with: the one asked for, or the only one
   * configured when none is named. 503 when nothing is configured.
   */
  private checkoutProvider(id: string | undefined): PaymentProvider {
    const enabled = this.registry.enabled();
    if (enabled.length === 0) throw new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED);
    if (!id) return enabled[0];
    const provider = this.registry.getEnabled(id);
    if (!provider) throw new BadRequestException(`Payment provider "${id}" is not available`);
    return provider;
  }

  /**
   * Expire the school's previous checkout session, so two checkouts started
   * one after the other (or in two tabs) cannot both become subscriptions.
   * 409 when it already completed: its subscription is about to arrive.
   */
  private async expirePendingCheckout(sub: SubscriptionRow): Promise<void> {
    if (!sub.pending_checkout_id) return;
    const provider = this.registry.find(sub.provider);
    if (!provider?.expireCheckoutSession) return;
    let expired: boolean;
    try {
      expired = await provider.expireCheckoutSession(sub.pending_checkout_id);
    } catch (err) {
      // A session the provider no longer knows (e.g. another account) is gone.
      if (err instanceof ProviderApiError && err.status === 404) return;
      throw err;
    }
    if (!expired) {
      throw new ConflictException(
        'A checkout for this school was just completed - it will be active in a moment',
      );
    }
  }

  /**
   * Start a subscription on the provider's hosted checkout. Plan and provider
   * are recorded now; the status changes when the provider's webhook
   * confirms the subscription.
   *
   * Checkouts for one school are serialized: the school's subscription row is
   * locked (SELECT ... FOR UPDATE) for the read of pending_checkout_id ->
   * expire that session -> create the new one -> store its id, so a second
   * checkout started at the same moment (two tabs, two admins) waits, then
   * sees and expires the first one's session. The provider call also gets an
   * idempotency key derived from the row it read (checkoutKey), so even two
   * attempts that read the same row get one session. Should two
   * subscriptions still arrive, the webhook cancels and refunds the second
   * (see BillingEventsService).
   */
  async checkout(caller: Caller, plan: BillingPlan, providerId?: string): Promise<PayResult> {
    const school = await this.adminSchool(caller.id);
    const provider = this.checkoutProvider(providerId);
    // The row to lock; created on first use.
    await this.subscriptions.ensure(school.id);
    const cfg = loadBillingConfig();
    const quantity = seatsFor(plan, await this.seats.countBillable(school.id));

    // A session created at the provider whose id might not be stored.
    let created: string | null = null;
    let result: CheckoutResult;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const sub = await this.lockSubscription(tx, school.id);

          // A live subscription with a provider we still know about must be
          // changed or canceled, not doubled. A row left by a removed
          // provider is not live.
          const subscribed =
            sub.provider_subscription_id && LIVE.has(sub.status) && this.registry.find(sub.provider);
          if (subscribed) {
            throw new ConflictException(
              'The school already has a live subscription - change plan or cancel it first',
            );
          }

          await this.expirePendingCheckout(sub);

          const res = await provider.createCheckout({
            schoolId: school.id,
            schoolName: school.name,
            customerEmail: caller.email ?? '',
            providerCustomerId: sub.provider === provider.id ? sub.provider_customer_id : null,
            price: planPrice(cfg, plan),
            quantity,
            successUrl: billingReturnUrl(cfg, 'success'),
            cancelUrl: billingReturnUrl(cfg, 'cancel'),
            idempotencyKey: checkoutKey(sub, provider.id, plan, quantity),
          });
          created = res.providerRef;
          await tx.subscription.update({
            where: { school_id: school.id },
            data: {
              plan,
              provider: provider.id,
              quantity,
              ...(res.providerCustomerId ? { provider_customer_id: res.providerCustomerId } : {}),
              ...(sub.provider !== provider.id ? { provider_subscription_id: null } : {}),
              pending_checkout_id: res.providerRef,
              updated_at: new Date(),
            },
          });
          return res;
        },
        { maxWait: CHECKOUT_TX_MAX_WAIT_MS, timeout: CHECKOUT_TX_TIMEOUT_MS },
      );
    } catch (err) {
      // The new session's id was not committed, so the next checkout could
      // not expire it: expire it now rather than leave it payable.
      if (created) await this.discardCheckout(provider, created);
      if (isLockTimeout(err)) {
        throw new ConflictException(
          'A checkout for this school is already being started - try again in a moment',
        );
      }
      throw err;
    }
    await this.subscriptions.invalidate(school.id);
    return { redirectUrl: result.redirectUrl };
  }

  /**
   * Lock the school's subscription row for the rest of the transaction and
   * read it. A concurrent checkout blocks here until this one commits (at
   * most 10s, then 409).
   */
  private async lockSubscription(
    tx: Prisma.TransactionClient,
    schoolId: string,
  ): Promise<SubscriptionRow> {
    await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
    await tx.$queryRaw`
      SELECT id FROM billing.subscription WHERE school_id = ${schoolId}::uuid FOR UPDATE`;
    const sub = await tx.subscription.findUnique({ where: { school_id: schoolId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  /** Best-effort expiry of a checkout session we could not record. */
  private async discardCheckout(provider: PaymentProvider, ref: string): Promise<void> {
    try {
      await provider.expireCheckoutSession?.(ref);
    } catch (err) {
      this.logger.error(
        `Could not expire unrecorded checkout session ${ref} (${provider.id}): ${(err as Error).message}`,
      );
    }
  }

  async changePlan(userId: string, plan: BillingPlan) {
    const school = await this.adminSchool(userId);
    const sub = await this.subscriptions.ensure(school.id);
    const provider = this.registry.find(sub.provider);
    const ref = this.ref(sub);
    let quantity = sub.quantity;
    if (provider && ref && LIVE.has(sub.status)) {
      if (!provider.changePlan) {
        throw new BadRequestException(`${provider.label} cannot change plans`);
      }
      quantity = seatsFor(plan, await this.seats.countBillable(school.id));
      await provider.changePlan(ref, planPrice(loadBillingConfig(), plan), quantity);
    }
    // Without a live provider subscription the plan is just remembered for
    // the next checkout.
    await this.prisma.subscription.update({
      where: { school_id: school.id },
      data: { plan, quantity, updated_at: new Date() },
    });
    await this.subscriptions.invalidate(school.id);
    return this.summaryFor(school.id);
  }

  async setCancel(userId: string, cancel: boolean) {
    const school = await this.adminSchool(userId);
    const sub = await this.subscriptions.ensure(school.id);
    if (!sub.provider || !sub.plan) {
      throw new ConflictException('There is no subscription to change');
    }
    // An unknown provider id (one since removed) has nothing to call; the
    // flag is still recorded and the hourly sweep ends the row on time.
    const provider = this.registry.find(sub.provider);
    const ref = this.ref(sub);
    if (provider && ref) {
      if (cancel) {
        if (!provider.cancel) throw new BadRequestException(`${provider.label} cannot cancel`);
        await provider.cancel(ref, { atPeriodEnd: true });
      } else {
        if (!provider.resume) throw new BadRequestException(`${provider.label} cannot resume`);
        await provider.resume(ref);
      }
    }
    await this.prisma.subscription.update({
      where: { school_id: school.id },
      data: { cancel_at_period_end: cancel, updated_at: new Date() },
    });
    await this.subscriptions.invalidate(school.id);
    return this.summaryFor(school.id);
  }

  async portal(userId: string): Promise<{ url: string | null }> {
    const school = await this.adminSchool(userId);
    const sub = await this.subscriptions.ensure(school.id);
    const provider = this.registry.find(sub.provider);
    const ref = this.ref(sub);
    if (!provider?.portalUrl || !ref) return { url: null };
    const url = await provider.portalUrl(
      ref,
      `${loadBillingConfig().appUrl}/dashboard/settings/billing`,
    );
    return { url: url ?? null };
  }

  async listInvoices(userId: string) {
    const school = await this.adminSchool(userId);
    const rows = await this.prisma.invoice.findMany({
      where: { school_id: school.id },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(invoiceDto);
  }
}
