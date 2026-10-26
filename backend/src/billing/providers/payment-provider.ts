/**
 * A payment provider. Stripe is the only one today (see stripe.provider.ts).
 *
 * Adding a provider means writing one of these and registering it in
 * ../billing.registry.ts - nothing else in the app knows which providers
 * exist. A registered provider is offered to schools when billing is on and
 * its `isConfigured()` is true.
 *
 * The provider runs the recurring billing itself: we start a subscription
 * with `createCheckout` (a provider-hosted page; no card form on our pages),
 * keep its seat count in step with `updateQuantity`, and learn about payments
 * and status changes from signed webhooks.
 *
 * Money is always integer minor units (cents) with an ISO currency code.
 */
export interface PaymentProvider {
  /** Stable id, stored on billing rows and used in the webhook URL. */
  readonly id: string;
  /** Shown to school admins: "Pay with <label>". */
  readonly label: string;

  /** Whether this deployment has the provider's credentials. */
  isConfigured(): boolean;

  /** Start a subscription on the provider's hosted checkout page. */
  createCheckout(ctx: CheckoutContext): Promise<CheckoutResult>;

  /**
   * Expire a hosted checkout session we started earlier, so it can no longer
   * turn into a subscription. Returns false when it already completed (a
   * subscription is on its way); true when it is expired now or already was.
   */
  expireCheckoutSession?(providerRef: string): Promise<boolean>;

  /**
   * The subscription as the provider holds it right now, or null when it does
   * not exist. Webhooks apply this rather than the event's own snapshot, so a
   * late or out-of-order event can never set an outdated state.
   */
  getSubscription?(providerSubscriptionId: string): Promise<ProviderSubscriptionState | null>;

  /**
   * Refund what the subscription's latest invoice collected, in full. Used
   * for a duplicate subscription billing refuses (two checkouts that raced).
   * Returns null when that invoice has no paid payment yet. Must be safe to
   * call again for the same invoice (no second refund).
   */
  refundLatestPayment?(providerSubscriptionId: string): Promise<RefundResult | null>;

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
   * Verify a webhook and translate it. MUST throw
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
  /**
   * Idempotency key for this checkout attempt. Derived from the school's
   * subscription row, so two attempts that read the same row get the same
   * key (and so the same session, or an error if their parameters differ).
   */
  idempotencyKey: string;
}

export interface CheckoutResult {
  /** Send the browser here; null when there is nothing to redirect to. */
  redirectUrl: string | null;
  /** The provider's id for what was created (checkout session, subscription, order). */
  providerRef: string | null;
  /** Customer created or reused, when the provider has customers. */
  providerCustomerId?: string | null;
}

export interface RefundResult {
  /** The invoice whose payment was refunded. */
  providerInvoiceId: string;
  /** The provider's refund ids (one per payment on the invoice). */
  refundIds: string[];
  /** Total refunded, minor units. */
  amountCents: number;
  currency: string;
}

export interface ProviderSubscriptionRef {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  plan: BillingPlan;
}

/** A provider subscription's current state, normalised. */
export interface ProviderSubscriptionState {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  /** From the metadata we attached at checkout. */
  schoolId: string | null;
  status: SubscriptionStatus;
  plan: BillingPlan | null;
  quantity: number | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
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

/**
 * Provider events, normalised. `eventId` is the provider's, used for
 * idempotency; `occurredAt` is when the provider created the event, used to
 * ignore events older than the newest one already applied.
 */
export type BillingEvent =
  | {
      type: 'subscription.updated';
      eventId: string;
      occurredAt?: Date | null;
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
      occurredAt?: Date | null;
      providerSubscriptionId: string;
      schoolId?: string | null;
    }
  | {
      type: 'invoice.paid';
      eventId: string;
      occurredAt?: Date | null;
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
      occurredAt?: Date | null;
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
