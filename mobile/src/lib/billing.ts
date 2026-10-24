import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api, ApiError } from "@/lib/api";
import { onSubscriptionRequired } from "@/lib/subscription-required";

/**
 * GET /api/billing/status. Self-hosted deployments run with billing off
 * (`enabled: false`, or a 404 from an API without billing routes); then the
 * app shows nothing billing-related. Billing is managed on the web only.
 */
export interface BillingStatus {
  enabled: boolean;
  readOnly: boolean;
  status: string | null;
  trialEndsAt: string | null;
}

const DISABLED: BillingStatus = {
  enabled: false,
  readOnly: false,
  status: null,
  trialEndsAt: null,
};

let current: BillingStatus = DISABLED;
const subscribers = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function set(next: BillingStatus) {
  current = next;
  subscribers.forEach((fn) => fn());
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  try {
    const res = await api<BillingStatus>("/billing/status", {
      skipAuthRedirect: true,
    });
    if (!res || typeof res !== "object" || !res.enabled) return DISABLED;
    return {
      enabled: true,
      readOnly: !!res.readOnly,
      status: res.status ?? null,
      trialEndsAt: res.trialEndsAt ?? null,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return DISABLED;
    throw err;
  }
}

/** Reloads the status; a transient failure keeps the previous value. */
export function refreshBillingStatus(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchBillingStatus()
    .then(set)
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Sign-out / school switch. */
export function resetBillingStatus() {
  set(DISABLED);
}

onSubscriptionRequired(() => {
  void refreshBillingStatus();
});

/**
 * The current status, loaded on mount (and `key` change) and refreshed when
 * the app returns to the foreground.
 */
export function useBillingStatus(key?: string | null): BillingStatus {
  const status = useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => current,
    () => current,
  );

  useEffect(() => {
    void refreshBillingStatus();
  }, [key]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshBillingStatus();
    });
    return () => sub.remove();
  }, []);

  return status;
}
