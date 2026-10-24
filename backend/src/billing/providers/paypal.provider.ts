import { Logger } from '@nestjs/common';
import {
  centsToDecimal,
  decimalToCents,
  env,
  fromIso,
  header,
  ProviderApiError,
  readJson,
  requireEnv,
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
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

const PLAN_ENV: Record<BillingPlan, string> = {
  per_user: 'PAYPAL_PLAN_PER_USER',
  flat: 'PAYPAL_PLAN_FLAT',
};

const PRODUCT_NAME = 'GradeBook';
const PLAN_NAMES: Record<BillingPlan, string> = {
  per_user: 'GradeBook per user',
  flat: 'GradeBook flat',
};

/**
 * The `reason` we send when "cancelling at period end". PayPal echoes it as
 * the subscription's status_change_note, which tells our own suspension
 * apart from PayPal suspending a subscription after failed payments.
 */
export const PAYPAL_CANCEL_AT_PERIOD_END_NOTE =
  'GradeBook: cancel at end of paid period';

/** Refresh the OAuth token this long before PayPal says it expires. */
const TOKEN_SLACK_MS = 60_000;

/** How many pages of products/plans to scan when looking for our own. */
const MAX_LIST_PAGES = 5;

interface Token {
  cacheKey: string;
  accessToken: string;
  expiresAt: number;
}

/**
 * PayPal Subscriptions over the REST API (no SDK - PayPal's Node SDKs for
 * subscriptions are deprecated).
 *
 * Plans: PAYPAL_PLAN_PER_USER / PAYPAL_PLAN_FLAT when set; otherwise a
 * "GradeBook" catalog product and one monthly plan per (plan, amount,
 * currency) are found or created on demand and cached in memory. The
 * per-user plan has `quantity_supported`, so a subscription bills
 * unit price x quantity.
 *
 * PayPal behaviour worth knowing (see docs/content/billing-providers.md):
 * - Cancel is always immediate. `cancel({ atPeriodEnd: true })` therefore
 *   SUSPENDS the subscription (no further charges; the school keeps the
 *   period it paid for) and `resume` re-activates it. The suspension is
 *   reported as active + cancelAtPeriodEnd, and a real cancel happens when
 *   the core cancels it immediately or the admin cancels in PayPal.
 * - Quantity and plan changes go through /revise, which PayPal documents as
 *   needing the subscriber's consent: when PayPal answers with an approval
 *   link the change only applies once the payer approves it. That link is
 *   logged (no secrets in it); PayPal keeps billing the old quantity until
 *   then.
 * - There is no customer portal; `portalUrl` returns null.
 *
 * Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID,
 * PAYPAL_ENV=sandbox|live (default sandbox); optional PAYPAL_PLAN_PER_USER,
 * PAYPAL_PLAN_FLAT, PAYPAL_PRODUCT_ID.
 */
export class PayPalProvider implements PaymentProvider {
  readonly id = 'paypal';
  readonly label = 'PayPal';
  readonly mode = 'subscription' as const;

  private readonly logger = new Logger(PayPalProvider.name);
  private readonly fetchFn: FetchLike;
  private token: Token | null = null;
  /** Product id and plan ids found or created, per environment + client. */
  private readonly catalog = new Map<string, string>();

  constructor(options: ProviderOptions = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  isConfigured(): boolean {
    return (
      !!env('PAYPAL_CLIENT_ID') &&
      !!env('PAYPAL_CLIENT_SECRET') &&
      !!env('PAYPAL_WEBHOOK_ID') &&
      this.environment() !== null
    );
  }

  async createCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const planId = await this.planId(ctx.price);
    const body: Record<string, unknown> = {
      plan_id: planId,
      custom_id: ctx.schoolId,
      subscriber: { email_address: ctx.customerEmail },
      // application_context is marked deprecated in the Subscriptions spec
      // but is still the only place for return/cancel URLs on this API.
      application_context: {
        brand_name: 'GradeBook',
        user_action: 'SUBSCRIBE_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: ctx.successUrl,
        cancel_url: ctx.cancelUrl,
      },
    };
    if (ctx.price.plan === 'per_user') {
      body.quantity = String(Math.max(1, ctx.quantity));
    }

    const sub = await this.api('POST', '/v1/billing/subscriptions', body, {
      'PayPal-Request-Id': ctx.idempotencyKey,
    });
    const approve = linkOf(sub, 'approve');
    if (!approve) {
      throw new ProviderApiError(this.label, 'subscription has no approve link');
    }
    return { redirectUrl: approve, providerRef: sub.id, providerCustomerId: null };
  }

  async updateQuantity(
    sub: ProviderSubscriptionRef,
    quantity: number,
  ): Promise<void> {
    await this.revise(sub.providerSubscriptionId, {
      quantity: String(Math.max(1, quantity)),
    });
  }

  async changePlan(
    sub: ProviderSubscriptionRef,
    plan: PlanPrice,
    quantity: number,
  ): Promise<void> {
    const body: Record<string, unknown> = { plan_id: await this.planId(plan) };
    if (plan.plan === 'per_user') body.quantity = String(Math.max(1, quantity));
    await this.revise(sub.providerSubscriptionId, body);
  }

  async cancel(
    sub: ProviderSubscriptionRef,
    opts: { atPeriodEnd: boolean },
  ): Promise<void> {
    const id = encodeURIComponent(sub.providerSubscriptionId);
    if (opts.atPeriodEnd) {
      // PayPal has no cancel-at-period-end; suspending stops future charges
      // and can be undone (resume), unlike a cancel.
      await this.api('POST', `/v1/billing/subscriptions/${id}/suspend`, {
        reason: PAYPAL_CANCEL_AT_PERIOD_END_NOTE,
      });
      return;
    }
    await this.api('POST', `/v1/billing/subscriptions/${id}/cancel`, {
      reason: 'Cancelled from GradeBook',
    });
  }

  async resume(sub: ProviderSubscriptionRef): Promise<void> {
    const id = encodeURIComponent(sub.providerSubscriptionId);
    await this.api('POST', `/v1/billing/subscriptions/${id}/activate`, {
      reason: 'Resumed from GradeBook',
    });
  }

  portalUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }

  async parseWebhook(req: WebhookRequest): Promise<BillingEvent[]> {
    const webhookId = env('PAYPAL_WEBHOOK_ID');
    if (!webhookId) {
      throw new WebhookVerificationError('PAYPAL_WEBHOOK_ID is not set');
    }
    const h = req.headers;
    const transmission = {
      auth_algo: header(h, 'paypal-auth-algo'),
      cert_url: header(h, 'paypal-cert-url'),
      transmission_id: header(h, 'paypal-transmission-id'),
      transmission_sig: header(h, 'paypal-transmission-sig'),
      transmission_time: header(h, 'paypal-transmission-time'),
    };
    const missing = Object.entries(transmission)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new WebhookVerificationError(
        `Missing PayPal transmission headers: ${missing.join(', ')}`,
      );
    }

    let event: any;
    try {
      event = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw new WebhookVerificationError('PayPal webhook body is not JSON');
    }
    if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
      throw new WebhookVerificationError('PayPal webhook body is not an event');
    }

    const result = await this.api(
      'POST',
      '/v1/notifications/verify-webhook-signature',
      { ...transmission, webhook_id: webhookId, webhook_event: event },
    );
    if (result?.verification_status !== 'SUCCESS') {
      throw new WebhookVerificationError(
        `PayPal signature verification returned ${result?.verification_status ?? 'nothing'}`,
      );
    }
    return [this.mapEvent(event)];
  }

  /** PayPal event -> normalised billing event. Exposed for tests. */
  mapEvent(event: any): BillingEvent {
    const eventId: string = event.id;
    const type: string = event.event_type ?? '';
    const r = event.resource ?? {};

    switch (type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
      case 'BILLING.SUBSCRIPTION.UPDATED':
      case 'BILLING.SUBSCRIPTION.RE-ACTIVATED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const ourSuspension =
          r.status === 'SUSPENDED' &&
          r.status_change_note === PAYPAL_CANCEL_AT_PERIOD_END_NOTE;
        const quantity = Number.parseInt(String(r.quantity ?? ''), 10);
        return {
          type: 'subscription.updated',
          eventId,
          providerSubscriptionId: r.id,
          providerCustomerId: null,
          schoolId: r.custom_id ?? null,
          status: ourSuspension ? 'active' : subscriptionStatus(r.status),
          plan: this.planOfId(r.plan_id),
          quantity: Number.isFinite(quantity) ? quantity : null,
          currentPeriodStart: fromIso(r.billing_info?.last_payment?.time),
          currentPeriodEnd: fromIso(r.billing_info?.next_billing_time),
          cancelAtPeriodEnd: ourSuspension,
        };
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        return {
          type: 'subscription.canceled',
          eventId,
          providerSubscriptionId: r.id,
          schoolId: r.custom_id ?? null,
        };

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        return {
          type: 'invoice.payment_failed',
          eventId,
          providerSubscriptionId: r.id ?? null,
          schoolId: r.custom_id ?? null,
        };

      case 'PAYMENT.SALE.COMPLETED': {
        if (!r.billing_agreement_id) {
          return { type: 'ignored', eventId, reason: 'sale is not for a subscription' };
        }
        const currency = String(r.amount?.currency ?? 'USD').toUpperCase();
        return {
          type: 'invoice.paid',
          eventId,
          providerInvoiceId: r.id ?? null,
          providerSubscriptionId: r.billing_agreement_id,
          schoolId: r.custom ?? r.custom_id ?? null,
          amountCents: decimalToCents(String(r.amount?.total ?? '0'), currency),
          currency,
          paidAt:
            fromIso(r.create_time) ?? fromIso(event.create_time) ?? new Date(),
        };
      }

      default:
        return { type: 'ignored', eventId, reason: `unhandled ${type}` };
    }
  }

  // ---------------------------------------------------------------------

  private environment(): keyof typeof BASE_URLS | null {
    const value = (env('PAYPAL_ENV') ?? 'sandbox').toLowerCase();
    if (value === 'sandbox') return 'sandbox';
    if (value === 'live' || value === 'production') return 'live';
    return null;
  }

  private baseUrl(): string {
    const environment = this.environment();
    if (!environment) {
      throw new ProviderApiError(this.label, 'PAYPAL_ENV must be sandbox or live');
    }
    return BASE_URLS[environment];
  }

  /** OAuth client-credentials token, cached until shortly before it expires. */
  private async accessToken(): Promise<string> {
    const clientId = requireEnv(this.label, 'PAYPAL_CLIENT_ID');
    const secret = requireEnv(this.label, 'PAYPAL_CLIENT_SECRET');
    const base = this.baseUrl();
    const cacheKey = `${base}|${clientId}`;
    if (
      this.token &&
      this.token.cacheKey === cacheKey &&
      this.token.expiresAt > Date.now()
    ) {
      return this.token.accessToken;
    }

    const res = await send(this.label, this.fetchFn, `${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await readJson(res);
    if (!res.ok || !data?.access_token) {
      throw new ProviderApiError(
        this.label,
        `token request failed: ${errorMessage(data) ?? res.statusText}`,
        res.status,
      );
    }
    const ttlMs = Number(data.expires_in ?? 0) * 1000;
    this.token = {
      cacheKey,
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_SLACK_MS),
    };
    return data.access_token;
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<any> {
    const token = await this.accessToken();
    const res = await send(this.label, this.fetchFn, `${this.baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation',
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401) this.token = null;
    const data = await readJson(res);
    if (!res.ok) {
      throw new ProviderApiError(
        this.label,
        `${method} ${path.split('?')[0]} failed: ${errorMessage(data) ?? res.statusText}`,
        res.status,
      );
    }
    return data;
  }

  private async revise(
    subscriptionId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.api(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/revise`,
      body,
    );
    const approve = linkOf(result, 'approve');
    if (approve) {
      this.logger.warn(
        `PayPal subscription ${subscriptionId}: the change needs the subscriber's approval before it applies (${approve})`,
      );
    }
  }

  /** The PayPal plan to bill: configured id, cached id, or found/created. */
  private async planId(price: PlanPrice): Promise<string> {
    const configured = env(PLAN_ENV[price.plan]);
    if (configured) return configured;

    const currency = price.currency.toUpperCase();
    const amount = centsToDecimal(price.unitAmountCents, currency);
    const name = `${PLAN_NAMES[price.plan]} ${currency} ${amount}`;
    const key = `${this.cachePrefix()}plan|${name}`;
    const cached = this.catalog.get(key);
    if (cached) return cached;

    const productId = await this.productId();
    const existing = await this.findByName(
      `/v1/billing/plans?product_id=${encodeURIComponent(productId)}`,
      'plans',
      name,
      (plan) => plan.status === 'ACTIVE',
    );
    const id: string =
      existing ??
      (
        await this.api(
          'POST',
          '/v1/billing/plans',
          {
            product_id: productId,
            name,
            description: `${PLAN_NAMES[price.plan]}, billed monthly`,
            status: 'ACTIVE',
            quantity_supported: price.plan === 'per_user',
            billing_cycles: [
              {
                frequency: { interval_unit: 'MONTH', interval_count: 1 },
                tenure_type: 'REGULAR',
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: {
                  fixed_price: { value: amount, currency_code: currency },
                },
              },
            ],
            payment_preferences: {
              auto_bill_outstanding: true,
              setup_fee_failure_action: 'CANCEL',
              payment_failure_threshold: 3,
            },
          },
          {
            'PayPal-Request-Id': `gradebook-plan-${productId}-${name}`.replace(
              /\s+/g,
              '-',
            ),
          },
        )
      ).id;
    this.catalog.set(key, id);
    this.catalog.set(`${this.cachePrefix()}plan-id|${id}`, price.plan);
    return id;
  }

  private async productId(): Promise<string> {
    const configured = env('PAYPAL_PRODUCT_ID');
    if (configured) return configured;
    const key = `${this.cachePrefix()}product`;
    const cached = this.catalog.get(key);
    if (cached) return cached;

    const id: string =
      (await this.findByName('/v1/catalogs/products?', 'products', PRODUCT_NAME)) ??
      (
        await this.api(
          'POST',
          '/v1/catalogs/products',
          {
            name: PRODUCT_NAME,
            description: 'GradeBook school platform subscription',
            type: 'SERVICE',
            category: 'SOFTWARE',
          },
          { 'PayPal-Request-Id': 'gradebook-product' },
        )
      ).id;
    this.catalog.set(key, id);
    return id;
  }

  /** Scan a PayPal list endpoint for an item with this exact name. */
  private async findByName(
    path: string,
    field: 'plans' | 'products',
    name: string,
    accept: (item: any) => boolean = () => true,
  ): Promise<string | null> {
    const sep = path.endsWith('?') ? '' : '&';
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const data = await this.api(
        'GET',
        `${path}${sep}page_size=20&page=${page}&total_required=true`,
      );
      const items: any[] = data?.[field] ?? [];
      const match = items.find((item) => item.name === name && accept(item));
      if (match) return match.id;
      const totalPages = Number(data?.total_pages ?? 1);
      if (items.length < 20 || page >= totalPages) break;
    }
    return null;
  }

  private planOfId(planId: unknown): BillingPlan | null {
    if (typeof planId !== 'string' || !planId) return null;
    if (planId === env(PLAN_ENV.per_user)) return 'per_user';
    if (planId === env(PLAN_ENV.flat)) return 'flat';
    const cached = this.catalog.get(`${this.cachePrefix()}plan-id|${planId}`);
    return cached === 'per_user' || cached === 'flat' ? cached : null;
  }

  private cachePrefix(): string {
    return `${this.environment() ?? '?'}|${env('PAYPAL_CLIENT_ID') ?? ''}|`;
  }
}

function subscriptionStatus(status: unknown): SubscriptionStatus {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'SUSPENDED':
      return 'past_due';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'canceled';
    default:
      // APPROVAL_PENDING, APPROVED
      return 'incomplete';
  }
}

function linkOf(resource: any, rel: string): string | null {
  const links: any[] = Array.isArray(resource?.links) ? resource.links : [];
  return links.find((l) => l?.rel === rel)?.href ?? null;
}

/** PayPal error body -> "NAME: message (issue: description)". */
function errorMessage(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.error_description === 'string') return data.error_description;
  const parts: string[] = [];
  if (data.name) parts.push(String(data.name));
  if (data.message) parts.push(String(data.message));
  const details = Array.isArray(data.details)
    ? data.details
        .map((d: any) => [d?.issue, d?.description].filter(Boolean).join(': '))
        .filter(Boolean)
    : [];
  let text = parts.join(': ');
  if (details.length) text += ` (${details.join('; ')})`;
  if (data.debug_id) text += ` [debug_id ${data.debug_id}]`;
  return text || null;
}
