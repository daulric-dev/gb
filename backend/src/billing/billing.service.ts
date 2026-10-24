import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { apiBase } from '@/sso/sso.config';
import {
  amountFor,
  billingEnabled,
  billingReturnUrl,
  loadBillingConfig,
  planPrice,
  seatsFor,
} from './billing.config';
import { BillingRegistry, info } from './billing.registry';
import { InvoiceService, invoiceDto, type InvoiceRow } from './invoice.service';
import { SeatService } from './seat.service';
import { SubscriptionService, type SubscriptionRow } from './subscription.service';
import type {
  BillingPlan,
  CheckoutResult,
  PaymentProvider,
  ProviderSubscriptionRef,
} from './providers/payment-provider';

export interface Caller {
  id: string;
  email?: string;
}

export interface PayResult {
  redirectUrl: string | null;
  instructions?: string;
}

const LIVE = new Set(['active', 'trialing', 'past_due']);

function payResult(r: CheckoutResult): PayResult {
  return r.instructions !== undefined
    ? { redirectUrl: r.redirectUrl, instructions: r.instructions }
    : { redirectUrl: r.redirectUrl };
}

/** School-side billing: what a school admin sees and does. */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BillingRegistry,
    private readonly subscriptions: SubscriptionService,
    private readonly seats: SeatService,
    private readonly invoices: InvoiceService,
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
    const [billableUsers, oldestDue, enabled] = await Promise.all([
      this.seats.countBillable(schoolId),
      this.subscriptions.oldestOpenDue(schoolId),
      this.registry.enabled(),
    ]);
    const ent = this.subscriptions.evaluate(sub, oldestDue);
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

  private async enabledProvider(id: string): Promise<PaymentProvider> {
    const provider = await this.registry.getEnabled(id);
    if (!provider) throw new BadRequestException(`Payment provider "${id}" is not available`);
    return provider;
  }

  async checkout(caller: Caller, plan: BillingPlan, providerId: string): Promise<PayResult> {
    const school = await this.adminSchool(caller.id);
    const provider = await this.enabledProvider(providerId);
    const sub = await this.subscriptions.ensure(school.id);
    const cfg = loadBillingConfig();

    const subscribedElsewhere =
      sub.provider_subscription_id &&
      LIVE.has(sub.status) &&
      this.registry.find(sub.provider)?.mode === 'subscription';
    if (subscribedElsewhere) {
      throw new ConflictException(
        'The school already has a live subscription - change plan or cancel it first',
      );
    }

    if (provider.mode === 'subscription') {
      if (!provider.createCheckout) {
        throw new BadRequestException(`${provider.label} cannot start a subscription`);
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
      // Plan and provider are recorded now; the status changes when the
      // provider's webhook confirms the subscription.
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
      return payResult(result);
    }

    // Invoice mode: choose the plan, raise the first invoice now, pay it.
    const updated = await this.prisma.subscription.update({
      where: { school_id: school.id },
      data: {
        plan,
        provider: provider.id,
        provider_subscription_id: null,
        cancel_at_period_end: false,
        updated_at: new Date(),
      },
    });
    const open = await this.prisma.invoice.findFirst({
      where: { school_id: school.id, status: 'open' },
    });
    if (open && open.plan !== plan) {
      // Re-priced: the old one is replaced.
      await this.invoices.voidInvoice(open.id, `Replaced at checkout (${plan})`);
    }
    const { invoice } = await this.invoices.raise(updated);
    await this.subscriptions.invalidate(school.id);
    return this.payInvoiceWith(provider, invoice, school, caller);
  }

  private async payInvoiceWith(
    provider: PaymentProvider,
    inv: InvoiceRow,
    school: { id: string; name: string },
    caller: Caller,
  ): Promise<PayResult> {
    if (provider.mode !== 'invoice' || !provider.payInvoice) {
      throw new BadRequestException(`${provider.label} cannot pay invoices`);
    }
    const cfg = loadBillingConfig();
    const result = await provider.payInvoice({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      schoolId: school.id,
      schoolName: school.name,
      customerEmail: caller.email ?? '',
      amountCents: inv.amount_cents,
      currency: inv.currency,
      description: `GradeBook ${inv.plan === 'flat' ? 'flat' : 'per-user'} plan, invoice ${inv.number}`,
      successUrl: billingReturnUrl(cfg, 'success'),
      cancelUrl: billingReturnUrl(cfg, 'cancel'),
      callbackUrl: `${apiBase()}/api/billing/webhooks/${provider.id}`,
    });
    return payResult(result);
  }

  async payInvoice(caller: Caller, invoiceId: string, providerId: string): Promise<PayResult> {
    const school = await this.adminSchool(caller.id);
    const inv = await this.prisma.invoice
      .findUnique({ where: { id: invoiceId } })
      .catch(() => null);
    if (!inv || inv.school_id !== school.id) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'open') throw new ConflictException(`Invoice is ${inv.status}`);
    const provider = await this.enabledProvider(providerId);
    return this.payInvoiceWith(provider, inv, school, caller);
  }

  async changePlan(userId: string, plan: BillingPlan) {
    const school = await this.adminSchool(userId);
    const sub = await this.subscriptions.ensure(school.id);
    const provider = this.registry.find(sub.provider);
    const ref = this.ref(sub);
    let quantity = sub.quantity;
    if (provider?.mode === 'subscription' && ref && LIVE.has(sub.status)) {
      if (!provider.changePlan) {
        throw new BadRequestException(`${provider.label} cannot change plans`);
      }
      quantity = seatsFor(plan, await this.seats.countBillable(school.id));
      await provider.changePlan(ref, planPrice(loadBillingConfig(), plan), quantity);
    }
    // Invoice mode: the next invoice is raised on the new plan.
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
    const provider = this.registry.find(sub.provider);
    if (!provider || !sub.plan) {
      throw new ConflictException('There is no subscription to change');
    }
    const ref = this.ref(sub);
    if (provider.mode === 'subscription' && ref) {
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
