/**
 * Step-up confirmation (backend `src/auth/step-up.*`): before changing single
 * sign-on settings the API wants a fresh 8-digit code from the signed-in
 * user's email. `api(path, { stepUp: true })` asks the registered dialog
 * (`StepUpDialogHost`) and retries the request once confirmed.
 */
import { api } from "@/lib/api";

/** Same length as a sign-in code. */
export const STEP_UP_CODE_LENGTH = 8;

/** Mail a code to the signed-in user's own address. */
export function sendStepUpCode(): Promise<{ sent: true }> {
  return api<{ sent: true }>("/auth/step-up/send", { method: "POST" });
}

/** Confirm the code; this session may change SSO settings until `elevatedUntil`. */
export function verifyStepUpCode(code: string): Promise<{ elevatedUntil: string }> {
  return api<{ elevatedUntil: string }>("/auth/step-up/verify", {
    method: "POST",
    body: { code: code.trim() },
  });
}

/** Only digits, at most STEP_UP_CODE_LENGTH of them (pasted codes keep working). */
export function cleanStepUpCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, STEP_UP_CODE_LENGTH);
}

/**
 * The dialog's side of `setStepUpHandler`: `request` shows it and waits;
 * `confirmed` / `dismissed` settle the wait and hide it. A second request
 * while one is open waits on the same answer.
 */
export function createStepUpPrompt(show: (open: boolean) => void) {
  let waiting: Promise<boolean> | null = null;
  let settle: ((ok: boolean) => void) | null = null;
  const finish = (ok: boolean) => {
    settle?.(ok);
    settle = null;
    waiting = null;
    show(false);
  };
  return {
    request(): Promise<boolean> {
      if (!waiting) {
        waiting = new Promise<boolean>((resolve) => (settle = resolve));
        show(true);
      }
      return waiting;
    },
    confirmed: () => finish(true),
    dismissed: () => finish(false),
  };
}
