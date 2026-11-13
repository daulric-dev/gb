import { api } from "@/lib/api";

/** Changing the sign-in email address (backend src/auth/email-change.*). */

export const EMAIL_CHANGE_CODE_LENGTH = 8;

export interface PendingEmailChange {
  email: string;
  expiresAt: string;
}

export const getPendingEmailChange = () =>
  api<{ pending: PendingEmailChange | null }>("/auth/email-change").then((r) => r?.pending ?? null);

/** Mails a code to the new address. Step-up first ("Confirm it's you"). */
export const requestEmailChange = (email: string) =>
  api<PendingEmailChange>("/auth/email-change", { method: "POST", body: { email }, stepUp: true });

export const confirmEmailChange = (code: string) =>
  api<{ email: string }>("/auth/email-change/confirm", { method: "POST", body: { code } });

export const cancelEmailChange = () => api("/auth/email-change", { method: "DELETE" });

/** Digits only, at most eight. */
export function cleanEmailCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, EMAIL_CHANGE_CODE_LENGTH);
}

/** A plausible address, different from the current one (the API checks properly). */
export function canAskForEmail(next: string, current: string | null | undefined): boolean {
  const v = next.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return false;
  return v !== (current ?? "").trim().toLowerCase();
}
