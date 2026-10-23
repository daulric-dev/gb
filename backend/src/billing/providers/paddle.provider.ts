import { createHmac } from 'node:crypto';
import {
  env,
  fromIso,
  header,
  ProviderApiError,
  readJson,
  requireEnv,
  safeEqual,
  send,
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

const BASE_URLS = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

const PRICE_ENV: Record<BillingPlan, string> = {
  per_user: 'PADDLE_PRICE_PER_USER',
  flat: 'PADDLE_PRICE_FLAT',
};

const PRODUCT_NAMES: Record<BillingPlan, string> = {
  per_user: 'GradeBook per user',
  flat: 'GradeBook flat',
};

/** Signatures older (or further in the future) than this are refused. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Upper bound on seats for inline prices (Paddle defaults to 1-100). */
const MAX_SEATS = 100_000;

const STATUS: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  // Paused subscriptions are not being billed.
  paused: 'past_due',
  canceled: 'canceled',
};

/**
 * Paddle Billing (not Paddle Classic) over its REST API with fetch. The
 * official SDK would add a dependency for what is a handful of JSON calls
 * and one HMAC check, and plain fetch keeps the same stubbable transport as
 * the other providers.
 *
 * Checkout creates an automatically-collected transaction and returns its
 * `checkout.url`: the account's **default payment link** with `?_ptxn=`
 * appended. That link must be set (Paddle > Checkout > Checkout settings)
 * and the page it points at must load Paddle.js, which opens the checkout
 * for the transaction. Optionally PADDLE_CHECKOUT_URL overrides the page per
 * transaction (it must be an approved domain).
 *
 * Prices: PADDLE_PRICE_PER_USER / PADDLE_PRICE_FLAT catalog prices when set
 * (monthly, quantity limits wide enough for your largest school); otherwise
 * non-catalog prices are created inline on the transaction - on
 * PADDLE_PRODUCT_ID when set, else on an inline non-catalog product.
 *
 * Paddle has no idempotency keys: the checkout key is stored in
 * custom_data so duplicates can be traced.
 *
 * Env: PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_ENV=sandbox|production
 * (default sandbox); optional PADDLE_PRICE_PER_USER, PADDLE_PRICE_FLAT,
 * PADDLE_PRODUCT_ID, PADDLE_CHECKOUT_URL.
 */
export class PaddleProvider implements PaymentProvider {
  readonly id = 'paddle';
  readonly label = 'Paddle';
  readonly mode = 'subscription' as const;

  private readonly fetchFn: FetchLike;

  constructor(options: ProviderOptions = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  isConfigured(): boolean {
    return (
      !!env('PADDLE_API_KEY') &&
      !!env('PADDLE_WEBHOOK_SECRET') &&
      this.environment() !== null
    );
  }

  async createCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const quantity = ctx.price.plan === 'flat' ? 1 : Math.max(1, ctx.quantity);
    const checkoutUrl = env('PADDLE_CHECKOUT_URL');
    const body: Record<string, unknown> = {
      items: [{ ...this.priceItem(ctx.price), quantity }],
      collection_mode: 'automatic',
      custom_data: {
        schoolId: ctx.schoolId,
        plan: ctx.price.plan,
        checkoutKey: ctx.idempotencyKey,
      },
      ...(ctx.providerCustomerId ? { customer_id: ctx.providerCustomerId } : {}),
      ...(checkoutUrl ? { checkout: { url: checkoutUrl } } : {}),
    };

    const { data } = await this.api('POST', '/transactions', body);
    const url: string | null = data?.checkout?.url ?? null;
    if (!url) {
      throw new ProviderApiError(
        this.label,
        'transaction has no checkout URL - set a default payment link in Paddle > Checkout > Checkout settings',
      );
    }
    return {
      redirectUrl: url,
      providerRef: data.id,
      providerCustomerId: data.customer_id ?? ctx.providerCustomerId ?? null,
    };
  }

  async updateQuantity(
    sub: ProviderSubscriptionRef,
    quantity: number,
  ): Promise<void> {
    const current = await this.subscription(sub.providerSubscriptionId);
    const items: any[] = current.items ?? [];
    if (!items.length) {
      throw new ProviderApiError(
        this.label,
        `subscription ${sub.providerSubscriptionId} has no items`,
      );
    }
    await this.api('PATCH', this.subPath(sub.providerSubscriptionId), {
      items: items.map((item, i) => ({
        price_id: item.price.id,
        quantity: i === 0 ? Math.max(1, quantity) : item.quantity,
      })),
      proration_billing_mode: 'prorated_immediately',
    });
  }

  async changePlan(
    sub: ProviderSubscriptionRef,
    plan: PlanPrice,
    quantity: number,
  ): Promise<void> {
    const current = await this.subscription(sub.providerSubscriptionId);
    await this.api('PATCH', this.subPath(sub.providerSubscriptionId), {
      items: [
        {
          ...this.priceItem(plan),
          quantity: plan.plan === 'flat' ? 1 : Math.max(1, quantity),
        },
      ],
      custom_data: { ...(current.custom_data ?? {}), plan: plan.plan },
      proration_billing_mode: 'prorated_immediately',
    });
  }

  async cancel(
    sub: ProviderSubscriptionRef,
    opts: { atPeriodEnd: boolean },
  ): Promise<void> {
    await this.api('POST', `${this.subPath(sub.providerSubscriptionId)}/cancel`, {
      effective_from: opts.atPeriodEnd ? 'next_billing_period' : 'immediately',
    });
  }

  /** Removes the scheduled cancellation. */
  async resume(sub: ProviderSubscriptionRef): Promise<void> {
    await this.api('PATCH', this.subPath(sub.providerSubscriptionId), {
      scheduled_change: null,
    });
  }

  /**
   * An authenticated customer portal link for the subscription. Paddle's
   * portal has no return URL; the admin closes the tab or uses its own
   * navigation.
   */
  async portalUrl(sub: ProviderSubscriptionRef): Promise<string | null> {
    let customerId = sub.providerCustomerId;
    if (!customerId) {
      customerId =
        (await this.subscription(sub.providerSubscriptionId)).customer_id ??
        null;
    }
    if (!customerId) return null;
    const { data } = await this.api(
      'POST',
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      { subscription_ids: [sub.providerSubscriptionId] },
    );
    return (
      data?.urls?.subscriptions?.[0]?.view_subscription ??
      data?.urls?.general?.overview ??
      null
    );
  }

  parseWebhook(req: WebhookRequest): Promise<BillingEvent[]> {
    try {
      this.verifySignature(req);
    } catch (err) {
      return Promise.reject(asError(err));
    }
    let event: any;
    try {
      event = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      return Promise.reject(
        new WebhookVerificationError('Paddle webhook body is not JSON'),
      );
    }
    if (!event || typeof event.event_id !== 'string') {
      return Promise.reject(
        new WebhookVerificationError('Paddle webhook body is not an event'),
      );
    }
    return Promise.resolve([this.mapEvent(event)]);
  }

  /** Paddle event -> normalised billing event. Exposed for tests. */
  mapEvent(event: any): BillingEvent {
    const eventId: string = event.event_id;
    const type: string = event.event_type ?? '';
    const d = event.data ?? {};

    switch (type) {
      case 'subscription.created':
      case 'subscription.activated':
      case 'subscription.updated':
      case 'subscription.past_due':
      case 'subscription.paused':
      case 'subscription.resumed':
      case 'subscription.trialing': {
        const item = d.items?.[0];
        return {
          type: 'subscription.updated',
          eventId,
          providerSubscriptionId: d.id,
          providerCustomerId: d.customer_id ?? null,
          schoolId: d.custom_data?.schoolId ?? null,
          status: STATUS[d.status] ?? 'incomplete',
          plan: planOf(d.custom_data?.plan) ?? this.planOfPrice(item?.price),
          quantity: typeof item?.quantity === 'number' ? item.quantity : null,
          currentPeriodStart: fromIso(d.current_billing_period?.starts_at),
          currentPeriodEnd: fromIso(d.current_billing_period?.ends_at),
          cancelAtPeriodEnd: d.scheduled_change?.action === 'cancel',
        };
      }

      case 'subscription.canceled':
        return {
          type: 'subscription.canceled',
          eventId,
          providerSubscriptionId: d.id,
          schoolId: d.custom_data?.schoolId ?? null,
        };

      // transaction.paid fires first for the same transaction; only the
      // final transaction.completed is reported as a payment so one
      // transaction is never counted twice.
      case 'transaction.completed': {
        const totals = d.details?.totals ?? {};
        const amount = String(totals.grand_total ?? totals.total ?? '0');
        if (!/^\d+$/.test(amount)) {
          return { type: 'ignored', eventId, reason: `unexpected amount ${amount}` };
        }
        return {
          type: 'invoice.paid',
          eventId,
          providerInvoiceId: d.id ?? null,
          providerSubscriptionId: d.subscription_id ?? null,
          schoolId: d.custom_data?.schoolId ?? null,
          amountCents: Number(amount),
          currency: String(d.currency_code ?? totals.currency_code ?? 'USD').toUpperCase(),
          paidAt:
            fromIso(d.payments?.find((p: any) => p?.captured_at)?.captured_at) ??
            fromIso(d.billed_at) ??
            fromIso(event.occurred_at) ??
            new Date(),
          periodStart: fromIso(d.billing_period?.starts_at),
          periodEnd: fromIso(d.billing_period?.ends_at),
        };
      }

      case 'transaction.payment_failed':
        return {
          type: 'invoice.payment_failed',
          eventId,
          providerInvoiceId: d.id ?? null,
          providerSubscriptionId: d.subscription_id ?? null,
          schoolId: d.custom_data?.schoolId ?? null,
        };

      default:
        return { type: 'ignored', eventId, reason: `unhandled ${type}` };
    }
  }

  // ---------------------------------------------------------------------

  /**
   * `Paddle-Signature: ts=<unix>;h1=<hex>` where h1 is
   * HMAC-SHA256(secret, `${ts}:${rawBody}`). Several h1 values may be
   * present while a secret is being rotated; any match passes.
   */
  private verifySignature(req: WebhookRequest): void {
    const secret = env('PADDLE_WEBHOOK_SECRET');
    if (!secret) {
      throw new WebhookVerificationError('PADDLE_WEBHOOK_SECRET is not set');
    }
    const sigHeader = header(req.headers, 'paddle-signature');
    if (!sigHeader) {
      throw new WebhookVerificationError('Missing Paddle-Signature header');
    }

    let ts: string | undefined;
    const signatures: string[] = [];
    for (const part of sigHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 'ts') ts = value;
      else if (key === 'h1') signatures.push(value.toLowerCase());
    }
    if (!ts || !/^\d+$/.test(ts) || !signatures.length) {
      throw new WebhookVerificationError('Malformed Paddle-Signature header');
    }
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (age > WEBHOOK_TOLERANCE_SECONDS) {
      throw new WebhookVerificationError('Paddle signature timestamp is too old');
    }

    const expected = createHmac('sha256', secret)
      .update(`${ts}:`)
      .update(req.rawBody)
      .digest('hex');
    if (!signatures.some((sig) => safeEqual(sig, expected))) {
      throw new WebhookVerificationError('Paddle signature does not match');
    }
  }

  private environment(): keyof typeof BASE_URLS | null {
    const value = (env('PADDLE_ENV') ?? 'sandbox').toLowerCase();
    if (value === 'sandbox') return 'sandbox';
    if (value === 'production' || value === 'live') return 'production';
    return null;
  }

  /** A transaction/subscription item: catalog price id, or a non-catalog price. */
  private priceItem(
    price: PlanPrice,
  ): { price_id: string } | { price: Record<string, unknown> } {
    const configured = env(PRICE_ENV[price.plan]);
    if (configured) return { price_id: configured };
    const product = env('PADDLE_PRODUCT_ID');
    return {
      price: {
        description: `${PRODUCT_NAMES[price.plan]} (GradeBook billing)`,
        name: price.plan === 'flat' ? 'Monthly, unlimited users' : 'Monthly, per user',
        unit_price: {
          amount: String(price.unitAmountCents),
          currency_code: price.currency.toUpperCase(),
        },
        billing_cycle: { interval: price.interval, frequency: 1 },
        quantity: { minimum: 1, maximum: price.plan === 'flat' ? 1 : MAX_SEATS },
        custom_data: { plan: price.plan },
        ...(product
          ? { product_id: product }
          : {
              product: {
                name: PRODUCT_NAMES[price.plan],
                tax_category: 'standard',
              },
            }),
      },
    };
  }

  private planOfPrice(price: any): BillingPlan | null {
    if (!price) return null;
    if (price.id && price.id === env(PRICE_ENV.per_user)) return 'per_user';
    if (price.id && price.id === env(PRICE_ENV.flat)) return 'flat';
    return planOf(price.custom_data?.plan);
  }

  private subPath(id: string): string {
    return `/subscriptions/${encodeURIComponent(id)}`;
  }

  private async subscription(id: string): Promise<any> {
    const { data } = await this.api('GET', this.subPath(id));
    return data ?? {};
  }

  private async api(method: string, path: string, body?: unknown): Promise<any> {
    const key = requireEnv(this.label, 'PADDLE_API_KEY');
    const environment = this.environment();
    if (!environment) {
      throw new ProviderApiError(this.label, 'PADDLE_ENV must be sandbox or production');
    }
    const res = await send(this.label, this.fetchFn, `${BASE_URLS[environment]}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Paddle-Version': '1',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      const error = data?.error;
      const detail = error
        ? [error.code, error.detail].filter(Boolean).join(': ') +
          (Array.isArray(error.errors) && error.errors.length
            ? ` (${error.errors.map((e: any) => `${e.field}: ${e.message}`).join('; ')})`
            : '')
        : res.statusText;
      throw new ProviderApiError(
        this.label,
        `${method} ${path} failed: ${detail}`,
        res.status,
      );
    }
    return data ?? {};
  }
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function planOf(value: unknown): BillingPlan | null {
  return value === 'per_user' || value === 'flat' ? value : null;
}
