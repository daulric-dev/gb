import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import {
  amountFor,
  billingEnabled,
  billingReturnUrl,
  loadBillingConfig,
  planPrice,
  seatsFor,
} from './billing.config';
import { BillingRegistry, info } from './billing.registry';
import { invoiceDto } from './invoice.service';
import { SeatService } from './seat.service';
import { SubscriptionService, type SubscriptionRow } from './subscription.service';
import type {
  BillingPlan,
  PaymentProvider,
  ProviderSubscriptionRef,
} from './providers/payment-provider';

export interface Caller {
  id: string;
  email?: string;
}

export interface PayResult {
  redirectUrl: string | null;
}

const LIVE = new Set(['active', 'trialing', 'past_due']);

export const PAYMENTS_NOT_CONFIGURED =
  'Payments are not configured yet - please contact support';

/** School-side billing: what a school admin sees and does. */
@Injectable()
export class BillingService {
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
   * Start a subscription on the provider's hosted checkout. Plan and provider
   * are recorded now; the status changes when the provider's webhook
   * confirms the subscription.
   */
  async checkout(caller: Caller, plan: BillingPlan, providerId?: string): Promise<PayResult> {
    const school = await this.adminSchool(caller.id);
    const provider = this.checkoutProvider(providerId);
    const sub = await this.subscriptions.ensure(school.id);
    const cfg = loadBillingConfig();

    // A live subscription with a provider we still know about must be changed
    // or canceled, not doubled. A row left by a removed provider is not live.
    const subscribed =
      sub.provider_subscription_id && LIVE.has(sub.status) && this.registry.find(sub.provider);
    if (subscribed) {
      throw new ConflictException(
        'The school already has a live subscription - change plan or cancel it first',
      );
    }

    const billable = await this.seats.countBillable(school.id);
    const quantity = seatsFor(plan, billable);
    const result = await provider.createCheckout({
      schoolId: school.id,
      schoolName: school.name,
      customerEmail: caller.email ?? '',
      providerCustomerId: sub.provider === provider.id ? sub.provider_customer_id : null,
      price: planPrice(cfg, plan),
      quantity,
      successUrl: billingReturnUrl(cfg, 'success'),
      cancelUrl: billingReturnUrl(cfg, 'cancel'),
      idempotencyKey: randomUUID(),
    });
    await this.prisma.subscription.update({
      where: { school_id: school.id },
      data: {
        plan,
        provider: provider.id,
        quantity,
        ...(result.providerCustomerId
          ? { provider_customer_id: result.providerCustomerId }
          : {}),
        ...(sub.provider !== provider.id ? { provider_subscription_id: null } : {}),
        updated_at: new Date(),
      },
    });
    await this.subscriptions.invalidate(school.id);
    return { redirectUrl: result.redirectUrl };
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
