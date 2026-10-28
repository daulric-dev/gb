import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
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

/**
 * The API's exact `error` for a mobile sign-in started without a
 * code_challenge (a build from before PKCE; backend OUTDATED_APP_MESSAGE).
 * Builds that old show it as is; this one never sends it, but maps it anyway.
 */
export const OUTDATED_APP_REASON =
  "This version of GradeBook is out of date. Update the app from the App Store or Google Play to sign in.";
export const OUTDATED_APP_MESSAGE =
  "This version of GradeBook is out of date. Update the app to sign in.";

/**
 * Turns the `error` the API puts on gradebook://sso into something to show.
 * Only known reason codes are mapped: anyone can open a gradebook:// link, so
 * the text itself is never shown.
 */
export function ssoErrorMessage(reason: string | null | undefined): string {
  if (reason === OUTDATED_APP_REASON) return OUTDATED_APP_MESSAGE;
  if (typeof reason === "string" && /^Your school signs in with /.test(reason)) {
    return "Your school requires its own sign-in option. Use your school's button.";
  }
  switch (reason) {
    case "cancelled":
    case "access_denied":
      return "Sign-in was cancelled.";
    case "expired":
      return "That sign-in took too long. Try again.";
    case "provider":
      return "That sign-in option isn't available right now. Try again or use an email code.";
    // The API's own refusals: fixed sentences, safe to show as written.
    case "This account is disabled":
    case "Your sign-in provider did not share an email address":
    case "An account with this email already exists. Sign in with an email code to link it.":
    case "Your sign-in provider did not confirm this email address. Sign in with an email code instead.":
      return reason;
    default:
      return "We couldn't finish signing you in. Try again.";
  }
}

// ── PKCE-style binding ──────────────────────────────────────────────────────
//
// The return URL (gradebook://sso?code=) can be caught by any app that claims
// the scheme, and anyone can send a victim such a link with their own code
// (login CSRF). So each sign-in starts with a secret verifier kept in the
// keychain, sends only its SHA-256 (code_challenge) to /start, and the API
// redeems the code only with the verifier.

const PENDING_KEY = "gb_sso_pending";
/** Matches the API's pending sign-in lifetime. */
const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingVerifier {
  verifier: string;
  expiresAt: number;
}

/** In-memory copy for where the keychain is unavailable (web). */
let pendingMemory: PendingVerifier | null = null;

/**
 * A high-entropy verifier: 32 bytes from the OS secure random source
 * (expo-crypto), as 64 hex characters - within PKCE's 43-128 unreserved
 * characters.
 */
function newVerifier(): string {
  const bytes = Crypto.getRandomBytes(32);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * base64url(SHA-256(verifier)), 43 characters: the code_challenge for /start
 * (RFC 7636 S256). The verifier is ASCII, so its UTF-8 bytes are the same.
 */
export async function codeChallengeFor(verifier: string): Promise<string> {
  const base64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Makes and keeps a fresh verifier for a sign-in; returns its challenge. */
async function beginPendingSignIn(): Promise<string> {
  const pending: PendingVerifier = {
    verifier: newVerifier(),
    expiresAt: Date.now() + PENDING_TTL_MS,
  };
  pendingMemory = pending;
  try {
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* web / no keychain: the in-memory copy still works for this run */
  }
  return await codeChallengeFor(pending.verifier);
}

/** The pending sign-in's verifier, or null when there is none or it expired. */
async function pendingVerifier(): Promise<string | null> {
  let pending = pendingMemory;
  if (!pending) {
    try {
      const raw = await SecureStore.getItemAsync(PENDING_KEY);
      pending = raw ? (JSON.parse(raw) as PendingVerifier) : null;
    } catch {
      pending = null;
    }
  }
  if (
    !pending ||
    typeof pending.verifier !== "string" ||
    typeof pending.expiresAt !== "number" ||
    pending.expiresAt <= Date.now()
  ) {
    return null;
  }
  return pending.verifier;
}

async function clearPendingSignIn(): Promise<void> {
  pendingMemory = null;
  try {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * Whether this app started a sign-in that is still waiting for its code. A
 * gradebook://sso link without one was not asked for and is ignored.
 */
export async function hasPendingSignIn(): Promise<boolean> {
  return (await pendingVerifier()) !== null;
}

/** Thrown by redeemSsoCode when this app has no sign-in waiting. */
export class NoPendingSignInError extends Error {
  constructor() {
    super("No sign-in in progress");
  }
}

/**
 * Codes being (or already) redeemed. A code is single use, and the same
 * return URL can reach the app twice - once as the auth session's result and
 * once as a deep link (Android delivers both) - so both share one request.
 */
const redemptions = new Map<string, Promise<void>>();

/**
 * Trades the one-time code, with this app's pending verifier, for a session.
 * Refuses (NoPendingSignInError) when no unexpired sign-in is waiting, and
 * clears the verifier afterwards either way: the API burns the code.
 */
export function redeemSsoCode(code: string): Promise<void> {
  let pending = redemptions.get(code);
  if (!pending) {
    pending = (async () => {
      const verifier = await pendingVerifier();
      if (!verifier) throw new NoPendingSignInError();
      try {
        await api<void>("/auth/sso/handoff", {
          method: "POST",
          body: { code, code_verifier: verifier },
          skipAuthRedirect: true,
        });
      } finally {
        await clearPendingSignIn();
      }
    })();
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
  let challenge: string;
  try {
    challenge = await beginPendingSignIn();
  } catch {
    return { type: "error", message: "Couldn't open the sign-in page." };
  }
  const params = [`platform=mobile`, `code_challenge=${challenge}`];
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
    if (!code) {
      await clearPendingSignIn();
      return { type: "error", message: ssoErrorMessage(error) };
    }
    claimedCodes.add(code);

    try {
      await redeemSsoCode(code);
      return { type: "success" };
    } catch (err) {
      return {
        type: "error",
        message:
          err instanceof ApiError && err.status < 500
            ? ssoErrorMessage("expired")
            : ssoErrorMessage("failed"),
      };
    }
  } finally {
    authSessionActive = false;
  }
}
