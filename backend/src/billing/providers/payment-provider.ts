/**
 * One payment provider (Stripe, PayPal, Paddle, WiPay, manual invoices...).
 *
 * Adding a provider means writing one of these and registering it in
 * ../billing.registry.ts - nothing else in the app knows which providers
 * exist. The platform operator picks which registered providers a deployment
 * offers (PAYMENT_PROVIDERS, then the on/off switches in the platform
 * dashboard); a school chooses among those at checkout.
 *
 * Two shapes of provider:
 *
 * - `subscription`: the provider runs the recurring billing itself (Stripe,
 *   PayPal, Paddle). We start a subscription with `createCheckout`, keep its
 *   seat count in step with `updateQuantity`, and learn about payments and
 *   status changes from webhooks.
 * - `invoice`: we raise an invoice each month and the provider only collects
 *   that one payment (WiPay's hosted page) or nothing at all (manual: bank
 *   transfer, marked paid by a platform admin).
 *
 * Money is always integer minor units (cents) with an ISO currency code.
 */
export interface PaymentProvider {
  /** Stable id, stored on billing rows and used in the webhook URL. */
  readonly id: string;
  /** Shown to school admins: "Pay with <label>". */
  readonly label: string;
  readonly mode: 'subscription' | 'invoice';

  /** Whether this deployment has the provider's credentials. */
  isConfigured(): boolean;

  createCheckout?(ctx: CheckoutContext): Promise<CheckoutResult>;

  payInvoice?(ctx: InvoicePaymentContext): Promise<CheckoutResult>;

  /** Change the billed seat count (per-user plan). Prorates as the provider does. */
  updateQuantity?(sub: ProviderSubscriptionRef, quantity: number): Promise<void>;

  /** Move an existing subscription to another plan (per-user <-> flat). */
  changePlan?(sub: ProviderSubscriptionRef, plan: PlanPrice, quantity: number): Promise<void>;

  /** Cancel now or at the end of the paid period. */
  cancel?(sub: ProviderSubscriptionRef, opts: { atPeriodEnd: boolean }): Promise<void>;

  /** Undo a pending cancel-at-period-end. */
  resume?(sub: ProviderSubscriptionRef): Promise<void>;

  /** A provider-hosted page to manage payment methods, when the provider has one. */
  portalUrl?(sub: ProviderSubscriptionRef, returnUrl: string): Promise<string | null>;

  /**
   * Verify a webhook (or a hosted-page callback) and translate it. MUST throw
   * WebhookVerificationError when the signature or hash does not check out;
   * never trust an unverified body. Unknown event types become `ignored`.
   */
  parseWebhook(req: WebhookRequest): Promise<BillingEvent[]>;
}

export type BillingPlan = 'per_user' | 'flat';

/** What a plan costs. per_user: unitAmount per seat; flat: unitAmount total, quantity 1. */
export interface PlanPrice {
  plan: BillingPlan;
  unitAmountCents: number;
  currency: string;
  interval: 'month';
}

export interface CheckoutContext {
  schoolId: string;
  schoolName: string;
  /** The admin starting checkout - prefill only, never a billing identity. */
  customerEmail: string;
  /** An existing provider customer for this school, if one was made before. */
  providerCustomerId: string | null;
  price: PlanPrice;
  /** Seats for per_user (billable users, at least 1); always 1 for flat. */
  quantity: number;
  /** Absolute URLs to return the browser to. */
  successUrl: string;
  cancelUrl: string;
  /** Idempotency key for this checkout attempt. */
  idempotencyKey: string;
}

export interface InvoicePaymentContext {
  invoiceId: string;
  invoiceNumber: string;
  schoolId: string;
  schoolName: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** Where the provider should call back for this payment, when it needs one per request. */
  callbackUrl: string;
}

export interface CheckoutResult {
  /** Send the browser here; null when there is nothing to redirect to (manual). */
  redirectUrl: string | null;
  /** The provider's id for what was created (checkout session, subscription, order). */
  providerRef: string | null;
  /** Customer created or reused, when the provider has customers. */
  providerCustomerId?: string | null;
  /** Shown to the admin instead of a redirect (bank details, reference to quote). */
  instructions?: string;
}

export interface ProviderSubscriptionRef {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  plan: BillingPlan;
}

export interface WebhookRequest {
  /** The exact bytes received; signatures are computed over these. */
  rawBody: Buffer;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

/** Provider events, normalised. `eventId` is the provider's, used for idempotency. */
export type BillingEvent =
  | {
      type: 'subscription.updated';
      eventId: string;
      providerSubscriptionId: string;
      providerCustomerId?: string | null;
      /** From the metadata we attached at checkout; may be absent on later events. */
      schoolId?: string | null;
      status: SubscriptionStatus;
      plan?: BillingPlan | null;
      quantity?: number | null;
      currentPeriodStart?: Date | null;
      currentPeriodEnd?: Date | null;
      cancelAtPeriodEnd?: boolean;
    }
  | {
      type: 'subscription.canceled';
      eventId: string;
      providerSubscriptionId: string;
      schoolId?: string | null;
    }
  | {
      type: 'invoice.paid';
      eventId: string;
      /** Our invoice id, for invoice-mode providers (from the metadata we sent). */
      invoiceId?: string | null;
      providerInvoiceId?: string | null;
      providerSubscriptionId?: string | null;
      schoolId?: string | null;
      amountCents: number;
      currency: string;
      paidAt: Date;
      periodStart?: Date | null;
      periodEnd?: Date | null;
    }
  | {
      type: 'invoice.payment_failed';
      eventId: string;
      invoiceId?: string | null;
      providerInvoiceId?: string | null;
      providerSubscriptionId?: string | null;
      schoolId?: string | null;
    }
  | { type: 'ignored'; eventId: string; reason: string };

/** Thrown by parseWebhook for anything that fails verification. Answered with 400. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
