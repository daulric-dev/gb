/** Single sign-on wire types and helpers (see backend `sso` module). */
import { buildUrl } from "@/lib/api";
import { NEXT_PARAM } from "@/lib/routing";

export interface SsoProvider {
  /** Adapter id, e.g. "google", "azure", "saml". */
  id: string;
  /** "Continue with <label>". */
  label: string;
  kind: "oauth" | "saml";
}

export interface SsoDiscovery {
  provider: SsoProvider | null;
  /** Email codes are refused for this address; only the provider works. */
  required: boolean;
}

export interface SsoSuggestedProfile {
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/**
 * The API address that starts a provider sign-in. It is a browser
 * navigation (redirects to the provider), never a fetch. `next` must already
 * be a safe same-origin path.
 */
export function ssoStartUrl(
  providerId: string,
  { email, next }: { email?: string | null; next?: string | null } = {},
): string {
  const params = new URLSearchParams();
  const trimmed = email?.trim();
  if (trimmed) params.set("email", trimmed);
  if (next) params.set(NEXT_PARAM, next);
  const query = params.toString();
  return buildUrl(
    `/auth/sso/${encodeURIComponent(providerId)}/start${query ? `?${query}` : ""}`,
  );
}

/** True for the OTP-send refusal of an address whose school requires SSO. */
export function isSsoRequiredMessage(message: string): boolean {
  return /signs in with/i.test(message);
}

const CALLBACK_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Try again when you're ready.",
  access_denied: "Sign-in was cancelled. Try again when you're ready.",
  expired: "That sign-in took too long or its link expired. Please try again.",
  provider: "That sign-in provider isn't available. Try another way to sign in.",
  failed: "Something went wrong finishing your sign-in. Please try again.",
};

const GENERIC_ERROR = "We couldn't sign you in. Please try again.";

/**
 * A friendly message for the `?error=` the SSO callback redirects back with:
 * one of a few reason codes, or a sentence from the API ("Your school signs
 * in with Google...") or the provider, which is shown as is.
 */
export function ssoErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const known = CALLBACK_ERRORS[value.toLowerCase()];
  if (known) return known;
  // Bare codes from the provider (server_error, invalid_request, ...).
  if (!/\s/.test(value)) return GENERIC_ERROR;
  return value.length > 300 ? `${value.slice(0, 297)}...` : value;
}

/** How the admin screens name a provider ("your school (SSO)" reads oddly there). */
export function ssoProviderName(provider: SsoProvider | undefined, id: string): string {
  if (!provider) return id;
  return provider.kind === "saml" ? "SAML" : provider.label;
}
