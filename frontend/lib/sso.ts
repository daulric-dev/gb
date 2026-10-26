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

/** The API's own refusals, shown as written. Anything else is generic. */
const SERVER_ERRORS = new Set([
  "This account is disabled",
  "Your sign-in provider did not share an email address",
  "An account with this email already exists. Sign in with an email code to link it.",
  "Your sign-in provider did not confirm this email address. Sign in with an email code instead.",
]);

const SSO_REQUIRED_ERROR =
  "Your school requires its own sign-in option. Use your school's button.";

/**
 * A friendly message for the `?error=` the SSO callback redirects back with:
 * one of a few reason codes, or one of the API's known refusals. Anyone can
 * link to /login?error=..., so free text is never shown as is.
 */
export function ssoErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const known = CALLBACK_ERRORS[value.toLowerCase()];
  if (known) return known;
  if (SERVER_ERRORS.has(value)) return value;
  if (isSsoRequiredMessage(value)) return SSO_REQUIRED_ERROR;
  return GENERIC_ERROR;
}

/** How the admin screens name a provider ("your school (SSO)" reads oddly there). */
export function ssoProviderName(provider: SsoProvider | undefined, id: string): string {
  if (provider?.kind === "saml" || (!provider && id === "saml")) return "SAML";
  return provider ? provider.label : id;
}

/**
 * What a school's SAML identity provider needs to know about us. The API
 * serves the metadata and receives assertions at the ACS URL. The entity ID is
 * the API's `SAML_SP_ENTITY_ID`; it defaults to the metadata URL, and
 * `NEXT_PUBLIC_SAML_SP_ENTITY_ID` must match the API when that is overridden.
 */
export function samlServiceProvider(): {
  metadataUrl: string;
  acsUrl: string;
  entityId: string;
} {
  const metadataUrl = buildUrl("/auth/sso/saml/metadata");
  return {
    metadataUrl,
    acsUrl: buildUrl("/auth/sso/saml/acs"),
    entityId: process.env.NEXT_PUBLIC_SAML_SP_ENTITY_ID || metadataUrl,
  };
}

/** True for an absolute https:// URL (the IdP sign-on URL must be one). */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !!url.hostname;
  } catch {
    return false;
  }
}

const PEM_CERT =
  /^-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----$/;
const BARE_BASE64 = /^[A-Za-z0-9+/=\s]+$/;

/**
 * A light shape check for an IdP signing certificate: a PEM block, or the
 * bare base64 body many IdPs show. The API parses it properly.
 */
export function looksLikeCertificate(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("-----")) return PEM_CERT.test(v);
  return BARE_BASE64.test(v) && v.replace(/\s/g, "").length >= 100;
}
