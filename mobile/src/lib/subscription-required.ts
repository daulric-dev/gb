import { Alert } from "react-native";

/**
 * A 402 `SUBSCRIPTION_REQUIRED` means the school's subscription has lapsed and
 * the platform is read-only for it (hosted platform only). One notice per
 * burst: a screen firing several writes would otherwise stack them.
 */
export const SUBSCRIPTION_LAPSED_MESSAGE =
  "Your school's subscription has lapsed - the platform is read-only";

const COOLDOWN_MS = 30_000;
let lastNoticeAt: number | null = null;
let noticeHandler: ((message: string) => void) | null = null;
const listeners = new Set<() => void>();

/** The ToastProvider registers itself here; without it an Alert is shown. */
export function setSubscriptionNoticeHandler(
  handler: ((message: string) => void) | null,
) {
  noticeHandler = handler;
}

export function onSubscriptionRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSubscriptionRequired(status: number, body: unknown): boolean {
  return (
    status === 402 &&
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "SUBSCRIPTION_REQUIRED"
  );
}

export function notifySubscriptionRequired(now: number = Date.now()): boolean {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Never let a listener swallow the caller's error.
    }
  }
  if (lastNoticeAt !== null && now - lastNoticeAt < COOLDOWN_MS) return false;
  lastNoticeAt = now;
  if (noticeHandler) noticeHandler(SUBSCRIPTION_LAPSED_MESSAGE);
  else Alert.alert("Read-only", SUBSCRIPTION_LAPSED_MESSAGE);
  return true;
}
