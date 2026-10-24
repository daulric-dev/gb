import * as WebBrowser from "expo-web-browser";
import { api, ApiError, buildUrl } from "@/lib/api";

/** Where the API sends the system browser back to (MOBILE_SSO_RETURN_URL). */
export const SSO_RETURN_URL = "gradebook://sso";

export interface SsoProvider {
  id: string;
  /** Shown as "Continue with <label>". */
  label: string;
  /** SAML providers are found by email domain, so they need the address. */
  kind: "oauth" | "saml";
}

export interface SsoDiscovery {
  provider: SsoProvider | null;
  /** Email codes are refused for this address; only the provider signs in. */
  required: boolean;
}

export interface SuggestedProfile {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export function fetchSsoProviders(): Promise<SsoProvider[]> {
  return api<SsoProvider[]>("/auth/sso/providers", { skipAuthRedirect: true });
}

export function discoverSso(email: string): Promise<SsoDiscovery> {
  return api<SsoDiscovery>(
    `/auth/sso/discover?email=${encodeURIComponent(email)}`,
    { skipAuthRedirect: true },
  );
}

export async function fetchSuggestedProfile(): Promise<SuggestedProfile | null> {
  const data = await api<{ profile: SuggestedProfile | null }>(
    "/auth/sso/suggested-profile",
    { skipAuthRedirect: true },
  );
  return data?.profile ?? null;
}

/** The OTP endpoints refuse an address whose school requires SSO with this. */
export function isSsoRequiredError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    /signs in with/i.test(err.message)
  );
}

/** Turns the `error` the API puts on gradebook://sso into something to show. */
export function ssoErrorMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "cancelled":
    case "access_denied":
      return "Sign-in was cancelled.";
    case "expired":
      return "That sign-in took too long. Try again.";
    case "provider":
      return "That sign-in option isn't available right now. Try again or use an email code.";
    case "failed":
    case undefined:
    case null:
    case "":
      return "We couldn't finish signing you in. Try again.";
    default:
      // Already a sentence, e.g. "Your school signs in with Google. ..." or
      // the provider's own error description.
      return reason;
  }
}

/**
 * Codes being (or already) redeemed. A code is single use, and the same
 * return URL can reach the app twice - once as the auth session's result and
 * once as a deep link (Android delivers both) - so both share one request.
 */
const redemptions = new Map<string, Promise<void>>();

/** Trades the one-time code for a session cookie in the app's cookie jar. */
export function redeemSsoCode(code: string): Promise<void> {
  let pending = redemptions.get(code);
  if (!pending) {
    pending = api<void>("/auth/sso/handoff", {
      method: "POST",
      body: { code },
      skipAuthRedirect: true,
    }).then(() => undefined);
    // A failed attempt stays failed: the API burns the code either way.
    redemptions.set(code, pending);
  }
  return pending;
}

/**
 * True while a sign-in started from the login screen is in the browser, and
 * for codes that sign-in has already taken. The `/sso` deep-link route checks
 * it so a return URL the login screen is handling is not handled twice.
 */
let authSessionActive = false;
const claimedCodes = new Set<string>();

export function isHandledByAuthSession(code?: string | null): boolean {
  return authSessionActive || (!!code && claimedCodes.has(code));
}

export type SsoResult =
  | { type: "success" }
  | { type: "cancel" }
  | { type: "error"; message: string };

function parseReturnUrl(url: string): { code?: string; error?: string } {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  const params: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [key, value = ""] = pair.split("=");
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(
        value.replace(/\+/g, " "),
      );
    } catch {
      params[key] = value;
    }
  }
  return { code: params.code, error: params.error };
}

/**
 * Runs a provider sign-in in the system browser and, when it comes back with
 * a code, redeems it. The caller refreshes the session and routes.
 */
export async function signInWithSso(
  providerId: string,
  email?: string,
): Promise<SsoResult> {
  const params = [`platform=mobile`];
  if (email) params.push(`email=${encodeURIComponent(email)}`);
  const startUrl = buildUrl(
    `/auth/sso/${encodeURIComponent(providerId)}/start?${params.join("&")}`,
  );

  authSessionActive = true;
  try {
    let result: WebBrowser.WebBrowserAuthSessionResult;
    try {
      result = await WebBrowser.openAuthSessionAsync(startUrl, SSO_RETURN_URL);
    } catch {
      return { type: "error", message: "Couldn't open the sign-in page." };
    }

    // Closed by the user (or the OS); nothing to say about it.
    if (result.type !== "success") return { type: "cancel" };

    const { code, error } = parseReturnUrl(result.url);
    if (!code) return { type: "error", message: ssoErrorMessage(error) };
    claimedCodes.add(code);

    try {
      await redeemSsoCode(code);
      return { type: "success" };
    } catch (err) {
      return {
        type: "error",
        message:
          err instanceof ApiError ? err.message : ssoErrorMessage("failed"),
      };
    }
  } finally {
    authSessionActive = false;
  }
}
