import { api, ApiError } from "@/lib/api";

/**
 * Authenticator-app two-step verification (backend `src/mfa`). The app does
 * the sign-in code step; setting an app up is done on the web (it needs the
 * "Confirm it's you" step-up, which the app does not have yet).
 */

export const MFA_CODE_LENGTH = 6;
export const MFA_REQUIRED = "MFA_REQUIRED";
export const MFA_ENROLMENT_REQUIRED = "MFA_ENROLMENT_REQUIRED";
/** Errors after which the challenge is gone: start the sign-in again. */
export const FINAL_MFA_ERRORS = new Set(["MFA_CHALLENGE_EXPIRED", "MFA_LOCKED"]);

/** The challenge token from a 403 MFA_REQUIRED, or null for any other error. */
export function mfaTokenFrom(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== MFA_REQUIRED) return null;
  const token = (err.data as { mfaToken?: unknown } | undefined)?.mfaToken;
  return typeof token === "string" ? token : null;
}

export function verifyMfaChallenge(input: {
  token: string;
  code?: string;
  recoveryCode?: string;
}) {
  return api<{ signedIn: true; recoveryCodeUsed: boolean; recoveryCodesRemaining: number }>(
    "/auth/mfa/verify",
    { method: "POST", body: input, skipAuthRedirect: true },
  );
}

/** Whether this session is limited to setting up an authenticator app. */
export async function enrolmentRequired(): Promise<boolean> {
  const status = await api<{ enrolmentRequired?: boolean }>("/auth/mfa", {
    skipAuthRedirect: true,
  }).catch(() => null);
  return status?.enrolmentRequired === true;
}

/** The web set-up page, when the app knows where the web app is. */
export function webSetupUrl(): string | null {
  const web = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "");
  return web ? `${web}/two-step-setup` : null;
}
