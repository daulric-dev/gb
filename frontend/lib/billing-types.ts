/**
 * Wire shapes for the hosted-platform billing API (`/api/billing/*`) and the
 * operator dashboard (`/api/platform/*`). Self-hosted deployments run with
 * billing off: `/billing/status` then says `enabled: false` and every other
 * route answers 404.
 */

export type BillingPlan = "per_user" | "flat";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "read_only";

export type ProviderMode = "subscription" | "invoice";

export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible";

export type MarkPaidMethod = "bank_transfer" | "cheque" | "cash" | "other";

/** GET /billing/status - any signed-in user. */
export interface BillingStatus {
  enabled: boolean;
  readOnly: boolean;
  status: SubscriptionStatus | null;
  trialEndsAt: string | null;
}

export interface BillingPrices {
  perUserCents: number;
  flatCents: number;
}

export interface BillingProviderOption {
  id: string;
  label: string;
  mode: ProviderMode;
}

/** GET /billing and the result of change-plan / cancel / resume. */
export interface BillingSummary {
  enabled: boolean;
  plan: BillingPlan | null;
  status: SubscriptionStatus;
  readOnly: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string | null;
  billableUsers: number;
  estimatedAmountCents: number;
  currency: string;
  prices: BillingPrices;
  providers: BillingProviderOption[];
}

/** POST /billing/checkout and POST /billing/invoices/:id/pay. */
export interface PayResult {
  redirectUrl: string | null;
  instructions?: string;
}

export interface Invoice {
  id: string;
  number: string;
  plan: BillingPlan;
  seats: number;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  provider: string | null;
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  paidAt: string | null;
  method: string | null;
}

// ---- Platform (operator) ------------------------------------------------

export interface PlatformMe {
  isPlatformAdmin: boolean;
}

export interface PlatformOverview {
  schools: number;
  trialing: number;
  active: number;
  pastDue: number;
  readOnly: number;
  mrrCents: number;
  currency: string;
  openInvoices: number;
}

export interface PlatformSchoolRow {
  schoolId: string;
  name: string;
  plan: BillingPlan | null;
  status: SubscriptionStatus;
  readOnly: boolean;
  provider: string | null;
  billableUsers: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  openInvoices: number;
}

export interface PlatformEvent {
  provider: string;
  type: string;
  createdAt: string;
}

export interface PlatformSchoolDetail extends PlatformSchoolRow {
  invoices: Invoice[];
  events: PlatformEvent[];
}

export interface PlatformInvoice extends Invoice {
  schoolId: string;
  schoolName: string;
}

export interface PlatformProvider {
  id: string;
  label: string;
  mode: ProviderMode;
  allowedByEnv: boolean;
  configured: boolean;
  enabled: boolean;
}
