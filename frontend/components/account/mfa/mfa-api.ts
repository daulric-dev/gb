import { api, ApiError } from "@/lib/api";
import { NEXT_PARAM } from "@/lib/routing";
import { TWO_STEP_SETUP_PATH } from "@/lib/mfa-redirect";

export { MFA_ENROLMENT_REQUIRED, TWO_STEP_SETUP_PATH } from "@/lib/mfa-redirect";

/**
 * Authenticator-app two-step verification (backend `src/mfa`): the calls,
 * and the two sign-in hand-offs the login pages make.
 */

export const MFA_CODE_LENGTH = 6;
/** API codes. */
export const MFA_REQUIRED = "MFA_REQUIRED";
/** The code step after the emailed code (or single sign-on). Signed-out page. */
export const TWO_STEP_PATH = "/login/two-step";
/** sessionStorage: the pending sign-in challenge, kept out of the URL. */
const CHALLENGE_KEY = "gb_mfa_challenge";

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  required: boolean;
  enrolmentRequired: boolean;
}

export interface MfaEnrolment {
  secret: string;
  otpauthUri: string;
  issuer: string;
  account: string;
}

export const getMfaStatus = () => api<MfaStatus>("/auth/mfa");

/** Step-up first ("Confirm it's you"); the dialog appears on its own. */
export const startMfaEnrolment = () =>
  api<MfaEnrolment>("/auth/mfa/enrol", { method: "POST", stepUp: true });

export const confirmMfaEnrolment = (code: string) =>
  api<{ recoveryCodes: string[] }>("/auth/mfa/enrol/confirm", {
    method: "POST",
    body: { code },
  });

export const regenerateRecoveryCodes = () =>
  api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", {
    method: "POST",
    stepUp: true,
  });

export const disableMfa = (input: { code?: string; recoveryCode?: string }) =>
  api<{ enabled: false }>("/auth/mfa/disable", {
    method: "POST",
    body: input,
    stepUp: true,
  });

export const verifyMfaChallenge = (input: {
  token: string;
  code?: string;
  recoveryCode?: string;
}) =>
  api<{ signedIn: true; recoveryCodeUsed: boolean; recoveryCodesRemaining: number }>(
    "/auth/mfa/verify",
    { method: "POST", body: input, skipAuthRedirect: true },
  );

export const getMfaPolicy = () =>
  api<{ requireMfaForAdmins: boolean }>("/organisation/mfa-policy");

export const setMfaPolicy = (requireMfaForAdmins: boolean) =>
  api<{ requireMfaForAdmins: boolean }>("/organisation/mfa-policy", {
    method: "PATCH",
    body: { requireMfaForAdmins },
    stepUp: true,
  });

export const resetUserMfa = (userId: string) =>
  api<{ reset: true }>(`/organisation/users/${encodeURIComponent(userId)}/mfa/reset`, {
    method: "POST",
    stepUp: true,
  });

/** Digits only, at most six. */
export function cleanMfaCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, MFA_CODE_LENGTH);
}

function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ [NEXT_PARAM]: next }).toString()}` : path;
}

export function storeChallenge(token: string) {
  try {
    sessionStorage.setItem(CHALLENGE_KEY, token);
  } catch {
    // Private mode without storage: the code step says the sign-in expired.
  }
}

/** The pending challenge token, once (it is removed as it is read). */
export function takeChallenge(): string | null {
  try {
    const token = sessionStorage.getItem(CHALLENGE_KEY);
    sessionStorage.removeItem(CHALLENGE_KEY);
    return token;
  } catch {
    return null;
  }
}

/**
 * For the email-code step's error handler: when the sign-in needs an
 * authenticator code, keep the challenge and go to the code step. True when
 * it did.
 */
export function startTwoStepChallenge(
  err: unknown,
  push: (path: string) => void,
  next: string | null,
): boolean {
  if (!(err instanceof ApiError) || err.code !== MFA_REQUIRED) return false;
  const token = (err.data as { mfaToken?: unknown } | undefined)?.mfaToken;
  if (typeof token !== "string") return false;
  storeChallenge(token);
  push(withNext(TWO_STEP_PATH, next));
  return true;
}

/**
 * Right after signing in: when the organisation requires an authenticator
 * app for this person and they have none, go and set one up. True when it
 * sent them there.
 */
export async function routeToTwoStepSetup(
  push: (path: string) => void,
  next: string | null,
): Promise<boolean> {
  const status = await getMfaStatus().catch(() => null);
  if (!status?.enrolmentRequired) return false;
  push(withNext(TWO_STEP_SETUP_PATH, next));
  return true;
}
