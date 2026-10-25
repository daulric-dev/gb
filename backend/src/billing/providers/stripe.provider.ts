import Stripe from 'stripe';
import {
  env,
  fromUnix,
  HTTP_TIMEOUT_MS,
  ProviderApiError,
  requireEnv,
} from './http';
import type { FetchLike, ProviderOptions } from './http';
import {
  WebhookVerificationError,
  type BillingEvent,
  type BillingPlan,
  type CheckoutContext,
  type CheckoutResult,
  type PaymentProvider,
  type PlanPrice,
  type ProviderSubscriptionRef,
  type SubscriptionStatus,
  type WebhookRequest,
} from './payment-provider';

/** Product names shown on Stripe Checkout, invoices and receipts. */
const PRODUCT_NAMES: Record<BillingPlan, string> = {
  per_user: 'GradeBook per user',
  flat: 'GradeBook flat',
};

/**
 * Stable product ids, so inline prices (price_data) always hang off the same
 * two products instead of a new product per checkout.
 */
const PRODUCT_IDS: Record<BillingPlan, string> = {
  per_user: 'gradebook_per_user',
  flat: 'gradebook_flat',
};

const PRICE_ENV: Record<BillingPlan, string> = {
  per_user: 'STRIPE_PRICE_PER_USER',
  flat: 'STRIPE_PRICE_FLAT',
};

/** Signatures older than this are refused (Stripe's default tolerance). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

const STATUS: Record<string, SubscriptionStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'unpaid',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  // A paused subscription (trial ended without a payment method) is not
  // being paid for.
  paused: 'past_due',
};

/**
 * Stripe Billing through the official SDK: Checkout Sessions in subscription
 * mode, subscription item updates for seat changes, the Billing customer
 * portal, and signed webhooks.
 *
 * Prices are either the operator's own Stripe prices (STRIPE_PRICE_PER_USER /
 * STRIPE_PRICE_FLAT, recurring monthly) or, when those are unset, inline
 * prices built from the platform's configured amounts on two stable products
 * (`gradebook_per_user`, `gradebook_flat`) that are created on first use.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; optional
 * STRIPE_PRICE_PER_USER, STRIPE_PRICE_FLAT.
 */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe';
  readonly label = 'Stripe';

  private readonly fetchFn: FetchLike | undefined;
  private client: { key: string; stripe: Stripe } | null = null;
  /** Products already known to exist, per secret key. */
  private readonly products = new Set<string>();

  constructor(options: ProviderOptions = {}) {
    this.fetchFn = options.fetch;
  }

  isConfigured(): boolean {
    return !!env('STRIPE_SECRET_KEY') && !!env('STRIPE_WEBHOOK_SECRET');
  }

  async createCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const stripe = this.stripe();
    const quantity = ctx.price.plan === 'flat' ? 1 : Math.max(1, ctx.quantity);
    const metadata = { schoolId: ctx.schoolId, plan: ctx.price.plan };

    const session = await this.call('create checkout session', async () =>
      stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          line_items: [{ ...(await this.priceParam(ctx.price)), quantity }],
          success_url: ctx.successUrl,
          cancel_url: ctx.cancelUrl,
          client_reference_id: ctx.schoolId,
          metadata,
          subscription_data: { metadata },
          ...(ctx.providerCustomerId
            ? { customer: ctx.providerCustomerId }
            : { customer_email: ctx.customerEmail }),
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );

    if (!session.url) {
      throw new ProviderApiError(this.label, 'checkout session has no URL');
    }
    return {
      redirectUrl: session.url,
      providerRef: session.id,
      providerCustomerId:
        stringId(session.customer) ?? ctx.providerCustomerId ?? null,
    };
  }

  async updateQuantity(
    sub: ProviderSubscriptionRef,
    quantity: number,
  ): Promise<void> {
    const stripe = this.stripe();
    const { item } = await this.firstItem(sub.providerSubscriptionId);
    await this.call('update subscription quantity', () =>
      stripe.subscriptions.update(sub.providerSubscriptionId, {
        items: [{ id: item.id, quantity: Math.max(1, quantity) }],
        proration_behavior: 'create_prorations',
      }),
    );
  }

  async changePlan(
    sub: ProviderSubscriptionRef,
    plan: PlanPrice,
    quantity: number,
  ): Promise<void> {
    const stripe = this.stripe();
    const { subscription, item } = await this.firstItem(
      sub.providerSubscriptionId,
    );
    const price = await this.priceParam(plan);
    await this.call('change subscription plan', () =>
      stripe.subscriptions.update(sub.providerSubscriptionId, {
        items: [
          {
            id: item.id,
            ...price,
            quantity: plan.plan === 'flat' ? 1 : Math.max(1, quantity),
          },
        ],
        proration_behavior: 'create_prorations',
        metadata: { ...subscription.metadata, plan: plan.plan },
      }),
    );
  }

  async cancel(
    sub: ProviderSubscriptionRef,
    opts: { atPeriodEnd: boolean },
  ): Promise<void> {
    const stripe = this.stripe();
    if (opts.atPeriodEnd) {
      await this.call('schedule cancellation', () =>
        stripe.subscriptions.update(sub.providerSubscriptionId, {
          cancel_at_period_end: true,
        }),
      );
      return;
    }
    await this.call('cancel subscription', () =>
      stripe.subscriptions.cancel(sub.providerSubscriptionId),
    );
  }

  async resume(sub: ProviderSubscriptionRef): Promise<void> {
    const stripe = this.stripe();
    await this.call('resume subscription', () =>
      stripe.subscriptions.update(sub.providerSubscriptionId, {
        cancel_at_period_end: false,
      }),
    );
  }

  async portalUrl(
    sub: ProviderSubscriptionRef,
    returnUrl: string,
  ): Promise<string | null> {
    const stripe = this.stripe();
    let customer = sub.providerCustomerId;
    if (!customer) {
      const subscription = await this.call('retrieve subscription', () =>
        stripe.subscriptions.retrieve(sub.providerSubscriptionId),
      );
      customer = stringId(subscription.customer);
    }
    if (!customer) return null;
    const session = await this.call('create portal session', () =>
      stripe.billingPortal.sessions.create({
        customer: customer,
        return_url: returnUrl,
      }),
    );
    return session.url;
  }

  async parseWebhook(req: WebhookRequest): Promise<BillingEvent[]> {
    const secret = env('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new WebhookVerificationError('STRIPE_WEBHOOK_SECRET is not set');
    }
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      throw new WebhookVerificationError('Missing Stripe-Signature header');
    }

    let event: Stripe.Event;
    try {
      // The async variant works with both Node's crypto and Web Crypto (Bun
      // and Workers resolve the SDK's worker build).
      event = await Stripe.webhooks.constructEventAsync(
        req.rawBody,
        signature,
        secret,
        WEBHOOK_TOLERANCE_SECONDS,
      );
    } catch (err) {
      throw new WebhookVerificationError(
        `Stripe signature check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return [this.mapEvent(event)];
  }

  /** Stripe event -> normalised billing event. Exposed for tests. */
  mapEvent(event: Stripe.Event): BillingEvent {
    const eventId = event.id;
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscriptionId = stringId(session.subscription);
        if (session.mode !== 'subscription' || !subscriptionId) {
          return {
            type: 'ignored',
            eventId,
            reason: 'not a subscription checkout',
          };
        }
        const paid =
          session.payment_status === 'paid' ||
          session.payment_status === 'no_payment_required';
        return {
          type: 'subscription.updated',
          eventId,
          providerSubscriptionId: subscriptionId,
          providerCustomerId: stringId(session.customer),
          schoolId:
            session.metadata?.schoolId ?? session.client_reference_id ?? null,
          status: paid ? 'active' : 'incomplete',
          plan: this.planOf(session.metadata?.plan),
        };
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const item = sub.items?.data?.[0];
        return {
          type: 'subscription.updated',
          eventId,
          providerSubscriptionId: sub.id,
          providerCustomerId: stringId(sub.customer),
          schoolId: sub.metadata?.schoolId ?? null,
          status: STATUS[sub.status] ?? 'incomplete',
          plan:
            this.planOf(sub.metadata?.plan) ?? this.planOfPrice(item?.price),
          quantity: item?.quantity ?? null,
          currentPeriodStart: fromUnix(item?.current_period_start),
          currentPeriodEnd: fromUnix(item?.current_period_end),
          cancelAtPeriodEnd:
            !!sub.cancel_at_period_end || sub.cancel_at != null,
        };
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        return {
          type: 'subscription.canceled',
          eventId,
          providerSubscriptionId: sub.id,
          schoolId: sub.metadata?.schoolId ?? null,
        };
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const details = invoice.parent?.subscription_details;
        const line = invoice.lines?.data?.[0];
        return {
          type: 'invoice.paid',
          eventId,
          providerInvoiceId: invoice.id ?? null,
          providerSubscriptionId: stringId(details?.subscription),
          schoolId: details?.metadata?.schoolId ?? null,
          amountCents: invoice.amount_paid,
          currency: invoice.currency.toUpperCase(),
          paidAt:
            fromUnix(invoice.status_transitions?.paid_at) ??
            new Date(event.created * 1000),
          periodStart: fromUnix(line?.period?.start ?? invoice.period_start),
          periodEnd: fromUnix(line?.period?.end ?? invoice.period_end),
        };
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const details = invoice.parent?.subscription_details;
        return {
          type: 'invoice.payment_failed',
          eventId,
          providerInvoiceId: invoice.id ?? null,
          providerSubscriptionId: stringId(details?.subscription),
          schoolId: details?.metadata?.schoolId ?? null,
        };
      }

      default:
        return { type: 'ignored', eventId, reason: `unhandled ${event.type}` };
    }
  }

  // ---------------------------------------------------------------------

  /** The SDK client, rebuilt if the secret key changes (tests, rotation). */
  protected stripe(): Stripe {
    const key = requireEnv(this.label, 'STRIPE_SECRET_KEY');
    if (this.client?.key !== key) {
      this.client = {
        key,
        stripe: new Stripe(key, {
          timeout: HTTP_TIMEOUT_MS,
          maxNetworkRetries: 2,
          appInfo: { name: 'GradeBook' },
          ...(this.fetchFn
            ? {
                httpClient: Stripe.createFetchHttpClient(
                  this.fetchFn as typeof fetch,
                ),
              }
            : {}),
        }),
      };
      this.products.clear();
    }
    return this.client.stripe;
  }

  /** Line item / subscription item price: the operator's price id or inline price_data. */
  private async priceParam(price: PlanPrice): Promise<
    | { price: string }
    | {
        price_data: {
          currency: string;
          product: string;
          unit_amount: number;
          recurring: { interval: 'month' };
        };
      }
  > {
    const configured = env(PRICE_ENV[price.plan]);
    if (configured) return { price: configured };
    return {
      price_data: {
        currency: price.currency.toLowerCase(),
        product: await this.ensureProduct(price.plan),
        unit_amount: price.unitAmountCents,
        recurring: { interval: price.interval },
      },
    };
  }

  /** Make sure the stable product for a plan exists; creates it on first use. */
  private async ensureProduct(plan: BillingPlan): Promise<string> {
    const id = PRODUCT_IDS[plan];
    if (this.products.has(id)) return id;
    const stripe = this.stripe();
    try {
      await stripe.products.retrieve(id);
    } catch (err) {
      if (
        !(err instanceof Stripe.errors.StripeError) ||
        err.statusCode !== 404
      ) {
        throw this.wrap('retrieve product', err);
      }
      try {
        await stripe.products.create(
          { id, name: PRODUCT_NAMES[plan], metadata: { gradebook_plan: plan } },
          { idempotencyKey: `gradebook-product-${id}` },
        );
      } catch (createErr) {
        // Created concurrently by another instance: fine.
        if (
          !(createErr instanceof Stripe.errors.StripeError) ||
          createErr.code !== 'resource_already_exists'
        ) {
          throw this.wrap('create product', createErr);
        }
      }
    }
    this.products.add(id);
    return id;
  }

  private async firstItem(subscriptionId: string): Promise<{
    subscription: Stripe.Subscription;
    item: Stripe.SubscriptionItem;
  }> {
    const stripe = this.stripe();
    const subscription = await this.call('retrieve subscription', () =>
      stripe.subscriptions.retrieve(subscriptionId),
    );
    const item = subscription.items.data[0];
    if (!item) {
      throw new ProviderApiError(
        this.label,
        `subscription ${subscriptionId} has no items`,
      );
    }
    return { subscription, item };
  }

  private planOf(value: string | undefined | null): BillingPlan | null {
    return value === 'per_user' || value === 'flat' ? value : null;
  }

  private planOfPrice(price: Stripe.Price | undefined): BillingPlan | null {
    if (!price) return null;
    if (price.id === env(PRICE_ENV.per_user)) return 'per_user';
    if (price.id === env(PRICE_ENV.flat)) return 'flat';
    const product = stringId(price.product);
    if (product === PRODUCT_IDS.per_user) return 'per_user';
    if (product === PRODUCT_IDS.flat) return 'flat';
    return null;
  }

  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.wrap(what, err);
    }
  }

  private wrap(what: string, err: unknown): Error {
    if (err instanceof ProviderApiError) return err;
    if (err instanceof Stripe.errors.StripeError) {
      return new ProviderApiError(
        this.label,
        `${what} failed: ${err.message}${err.code ? ` (${err.code})` : ''}`,
        err.statusCode ?? null,
      );
    }
    return new ProviderApiError(
      this.label,
      `${what} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Expandable Stripe field -> id. */
function stringId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}
