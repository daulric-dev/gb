import { toast } from "sonner";

/**
 * A 402 `SUBSCRIPTION_REQUIRED` from the API means the school's subscription
 * has lapsed and the platform is read-only for it. A page that fires several
 * writes at once (or a user clicking Save repeatedly) would otherwise stack a
 * toast per request, so this shows one and stays quiet for a while after.
 */

export const SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED";
export const SUBSCRIPTION_LAPSED_MESSAGE =
  "Your school's subscription has lapsed - the platform is read-only";

const TOAST_ID = "subscription-required";
/** How long after one notice further 402s stay silent. */
export const NOTICE_COOLDOWN_MS = 30_000;

let lastNoticeAt: number | null = null;
const listeners = new Set<() => void>();

/** True when an API error body is the read-only refusal. */
export function isSubscriptionRequired(status: number, body: unknown): boolean {
  return (
    status === 402 &&
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === SUBSCRIPTION_REQUIRED
  );
}

/** Called on every 402 refusal (e.g. to refresh the billing status). */
export function onSubscriptionRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows the read-only toast unless one was shown within the cooldown, and
 * tells listeners either way. Returns whether a toast was shown.
 */
export function notifySubscriptionRequired(now: number = Date.now()): boolean {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener failing must not stop the caller from getting its error.
    }
  }
  if (lastNoticeAt !== null && now - lastNoticeAt < NOTICE_COOLDOWN_MS) {
    return false;
  }
  lastNoticeAt = now;
  if (typeof window !== "undefined") {
    toast.error(SUBSCRIPTION_LAPSED_MESSAGE, { id: TOAST_ID });
  }
  return true;
}

/** Test hook: forget the last notice. */
export function resetSubscriptionNotice() {
  lastNoticeAt = null;
}
