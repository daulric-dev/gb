import { useEffect } from "react";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, ApiError } from "@/lib/api";
import { onSubscriptionRequired } from "@/lib/subscription-required";
import type {
  BillingPlan,
  BillingPrices,
  BillingStatus,
  InvoiceStatus,
  PlatformMe,
  SubscriptionStatus,
} from "@/lib/billing-types";

/**
 * School billing state for the hosted platform. Self-hosted deployments run
 * with billing off; `/billing/status` then says `enabled: false` (or, on an
 * API that predates billing, answers 404) and nothing billing-related renders.
 */

export const BILLING_DISABLED: BillingStatus = {
  enabled: false,
  readOnly: false,
  status: null,
  trialEndsAt: null,
};

/** Current status. Components reading it must call `useSignals()`. */
export const billingStatus = signal<BillingStatus>(BILLING_DISABLED);
/** True once the first status request has settled. */
export const billingLoaded = signal(false);
/** Whether the signed-in user operates the platform; null until known. */
export const platformAdmin = signal<boolean | null>(null);

/** The web billing page, also the provider return URL. */
export const BILLING_PATH = "/dashboard/settings/billing";

/**
 * GET /billing/status, normalised: a 404 (billing routes absent) or
 * `enabled: false` both mean billing is off. Other failures throw.
 */
export async function fetchBillingStatus(): Promise<BillingStatus> {
  try {
    const res = await api<BillingStatus>("/billing/status", {
      skipAuthRedirect: true,
      skipSubscriptionNotice: true,
    });
    if (!res || typeof res !== "object" || !res.enabled) return BILLING_DISABLED;
    return {
      enabled: true,
      readOnly: !!res.readOnly,
      status: res.status ?? null,
      trialEndsAt: res.trialEndsAt ?? null,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return BILLING_DISABLED;
    throw err;
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Reloads the status into `billingStatus`. A transient failure keeps what was
 * there (disabled, if nothing has loaded yet) rather than flashing banners.
 */
export function refreshBillingStatus(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchBillingStatus()
    .then((status) => {
      billingStatus.value = status;
    })
    .catch(() => {
      // Keep the previous value.
    })
    .finally(() => {
      billingLoaded.value = true;
      inFlight = null;
    });
  return inFlight;
}

/** Loads the status once per session; later calls are no-ops. */
export function ensureBillingStatus(): Promise<void> {
  if (billingLoaded.value) return Promise.resolve();
  return refreshBillingStatus();
}

/** Forget everything (sign-out, school switch, tests). */
export function resetBillingState() {
  billingStatus.value = BILLING_DISABLED;
  billingLoaded.value = false;
  platformAdmin.value = null;
  platformInFlight = null;
}

// A 402 from anywhere means the status we hold is stale.
onSubscriptionRequired(() => {
  void refreshBillingStatus();
});

let platformInFlight: Promise<boolean> | null = null;

/** GET /platform/me; 404 or any failure means "not a platform admin". */
export function loadPlatformAdmin(): Promise<boolean> {
  if (platformAdmin.value !== null) return Promise.resolve(platformAdmin.value);
  if (platformInFlight) return platformInFlight;
  platformInFlight = api<PlatformMe>("/platform/me", { skipAuthRedirect: true })
    .then((res) => !!res?.isPlatformAdmin)
    .catch(() => false)
    .then((value) => {
      platformAdmin.value = value;
      platformInFlight = null;
      return value;
    });
  return platformInFlight;
}

/** Minimum gap between focus-triggered refreshes. */
const FOCUS_REFRESH_MS = 60_000;

/**
 * Loads the billing status once and refreshes it when the window regains
 * focus (a payment finished in another tab, an operator extended the trial).
 * Mount it once per app shell; `schoolKey` reloads on a school switch.
 */
export function useBillingStatusLoader(schoolKey: string | null | undefined) {
  useEffect(() => {
    void refreshBillingStatus();
  }, [schoolKey]);

  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - last < FOCUS_REFRESH_MS) return;
      last = Date.now();
      void refreshBillingStatus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
}

/** The current billing status; everything is falsy while billing is off. */
export function useBillingStatus() {
  useSignals();
  const status = billingStatus.value;
  return {
    ...status,
    loaded: billingLoaded.value,
    refresh: refreshBillingStatus,
  };
}

// ---- Formatting & arithmetic -------------------------------------------

/** Minor-unit digits for a currency (2 for USD, 0 for JPY). */
function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", { style: "currency", currency })
        .resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Minor units (cents) as a localized currency string: 30000, USD → $300.00. */
export function formatMoney(
  cents: number,
  currency: string = "USD",
  locale?: string,
): string {
  const code = (currency || "USD").toUpperCase();
  const amount = cents / 10 ** fractionDigits(code);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/** Seats billed: never fewer than one. */
export function billableSeats(users: number): number {
  return Math.max(1, Math.floor(Number.isFinite(users) ? users : 0));
}

/** Monthly amount in cents for a plan, from the prices the API returned. */
export function estimateAmountCents(
  plan: BillingPlan,
  users: number,
  prices: BillingPrices,
): number {
  return plan === "flat"
    ? prices.flatCents
    : prices.perUserCents * billableSeats(users);
}

/** Whole days left until `iso` (rounded up, never negative), or null. */
export function daysUntil(
  iso: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

export function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export const PLAN_LABELS: Record<BillingPlan, string> = {
  per_user: "Per user",
  flat: "Flat",
};

export function planLabel(plan: BillingPlan | null | undefined): string {
  return plan ? PLAN_LABELS[plan] ?? plan : "No plan";
}

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  read_only: "Read-only",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status as SubscriptionStatus] ?? status;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function statusVariant(status: string | null | undefined): BadgeVariant {
  switch (status) {
    case "active":
      return "default";
    case "trialing":
      return "secondary";
    case "past_due":
    case "unpaid":
    case "read_only":
      return "destructive";
    default:
      return "outline";
  }
}

export function invoiceStatusVariant(status: InvoiceStatus): BadgeVariant {
  switch (status) {
    case "paid":
      return "default";
    case "open":
      return "secondary";
    case "uncollectible":
      return "destructive";
    default:
      return "outline";
  }
}

/** Only follow provider redirects to http(s) URLs. */
export function safeRedirect(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    window.location.assign(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

/** An ApiError's message, or a fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}
