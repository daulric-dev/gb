/**
 * Wire types and helpers for a school's own sign-in apps (Google, Microsoft,
 * a custom OpenID Connect provider; SAML is listed but set per domain):
 * the school admin's `/schools/current/sso/providers` and the organisation
 * console's `/organisation/schools/<id>/sso/providers` (backend
 * `src/sso/school-sso.service.ts`). Secrets never come back from the API:
 * only whether one is set and whose it is.
 */
import type { EmailDomain } from "@/lib/email-domains";
import { CURRENT_SCHOOL_API } from "@/lib/organisation";
import type { SsoProvider } from "@/lib/sso";

/** Whose value it is: the school's own, or the server's install-wide fallback. */
export type SettingSource = "school" | "env";

export interface SignInSettingField {
  key: string;
  label: string;
  description: string;
  placeholder?: string;
  /** Free text (default), a URL, a choice from `options`, or an on/off switch ("true" when on). */
  type?: "text" | "url" | "select" | "switch";
  /** `select`: the values it may take; the first is the default (saved as empty). */
  options?: { value: string; label: string }[];
  /** A caution shown with the field (for a switch: while it is on). */
  warning?: string;
}

export interface SchoolSsoProvider {
  /** Adapter id: `google`, `azure` (Microsoft), `oidc` (custom OpenID Connect), `saml`. */
  key: string;
  /** The admin name ("Custom OpenID Connect", "SAML 2.0"). */
  label: string;
  /** What this school's login button says: "Continue with <buttonLabel>". */
  buttonLabel?: string;
  kind: "oauth" | "saml";
  /** Switched on for this school. */
  enabled: boolean;
  /** Enabled and fully configured: the school's domains can use it. */
  available: boolean;
  /** `school` once the school saved its own app; `env` uses the server's, if any. */
  configSource: SettingSource;
  needsClient: boolean;
  /** The client ID in effect (not secret). */
  clientId: string | null;
  hasSecret: boolean;
  secretSource: SettingSource | null;
  /** A saved secret no longer decrypts (the server's AUTH_SECRET changed). */
  secretUnreadable: boolean;
  settings: Record<string, string>;
  settingFields: SignInSettingField[];
  /** OAuth: the redirect URI to register at the provider. */
  redirectUri: string | null;
  /** SAML: what each domain's identity provider is given. */
  saml: { metadataUrl: string; acsUrl: string; entityId: string } | null;
  notes: string | null;
  updatedAt: string | null;
}

/**
 * Where a school's sign-in apps live. Default: the active school's
 * (`/schools/current/sso/providers`, school admins); the organisation console
 * passes `organisationSchoolApi(id)`.
 */
export function ssoProvidersApi(apiBase: string = CURRENT_SCHOOL_API): string {
  return `${apiBase}/sso/providers`;
}

/** GET /organisation/sign-in/domains: one row per domain, every school. */
export interface OrganisationDomain extends EmailDomain {
  schoolId: string;
  schoolName: string;
}

/** The form state of one provider row. */
export interface ProviderDraft {
  enabled: boolean;
  /** The school's own client ID; empty while it uses the server's app. */
  clientId: string;
  /** Typed only to replace the secret; empty keeps the saved one. */
  clientSecret: string;
  /** Set to clear the school's saved secret. */
  clearSecret: boolean;
  settings: Record<string, string>;
}

export function draftOf(p: SchoolSsoProvider): ProviderDraft {
  const own = p.configSource === "school";
  const settings: Record<string, string> = {};
  for (const f of p.settingFields) settings[f.key] = own ? (p.settings[f.key] ?? "") : "";
  return {
    enabled: p.enabled,
    clientId: own ? (p.clientId ?? "") : "",
    clientSecret: "",
    clearSecret: false,
    settings,
  };
}

export interface ProviderUpdate {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  settings?: Record<string, string | null>;
}

/** The PUT body for what changed in a row, or null when nothing did. */
export function providerUpdate(p: SchoolSsoProvider, draft: ProviderDraft): ProviderUpdate | null {
  const base = draftOf(p);
  const body: ProviderUpdate = {};
  if (p.needsClient) {
    if (draft.clientId.trim() !== base.clientId) body.clientId = draft.clientId.trim();
    if (draft.clientSecret.trim()) body.clientSecret = draft.clientSecret.trim();
    else if (draft.clearSecret && p.secretSource === "school") body.clientSecret = "";
  }
  const settings: Record<string, string | null> = {};
  for (const f of p.settingFields) {
    const next = draft.settings[f.key]?.trim() ?? "";
    if (next !== (base.settings[f.key] ?? "")) settings[f.key] = next || null;
  }
  if (Object.keys(settings).length > 0) body.settings = settings;
  const changed = Object.keys(body).length > 0;
  // A school's first save starts its own app, off unless it says on: send
  // the switch along so saving credentials over the server's app keeps it on.
  if (draft.enabled !== p.enabled || (changed && p.configSource === "env")) {
    body.enabled = draft.enabled;
  }
  return Object.keys(body).length > 0 ? body : null;
}

/** What the secret field says instead of the secret. */
export function secretStatus(p: SchoolSsoProvider): string {
  if (p.secretUnreadable) {
    return "The saved secret can't be read since the server's AUTH_SECRET changed - enter it again";
  }
  if (p.secretSource === "school") return "Saved";
  if (p.secretSource === "env") return "Using the server's app";
  return "Not set";
}

/** A hint under the client ID while the school uses the server's app. */
export function clientIdHint(p: SchoolSsoProvider): string | null {
  if (p.configSource === "env" && p.clientId) {
    return `Using the server's app (${p.clientId}). Enter your own to replace it.`;
  }
  return null;
}

/** The row's status badge. "Not set up" until something is configured. */
export function providerStatus(p: SchoolSsoProvider): {
  label: string;
  tone: "ok" | "warn" | "off";
} {
  if (p.available) {
    return { label: p.configSource === "env" ? "On - server's app" : "On", tone: "ok" };
  }
  if (p.configSource === "school") {
    return p.enabled
      ? { label: "Setup incomplete", tone: "warn" }
      : { label: "Off", tone: "off" };
  }
  return { label: "Not set up", tone: "off" };
}

/** The OAuth apps a school can set up itself (Google, Microsoft, OpenID Connect). */
export function signInApps(list: SchoolSsoProvider[]): SchoolSsoProvider[] {
  return list.filter((p) => p.needsClient);
}

/** The SAML entry: nothing to save here, each email domain holds its IdP. */
export function samlApp(list: SchoolSsoProvider[]): SchoolSsoProvider | null {
  return list.find((p) => p.kind === "saml") ?? null;
}

/**
 * How the domain picker names a provider: a school-named one (custom OpenID
 * Connect's button name) as "Riverside ID (OpenID Connect)", others by label.
 */
export function pickLabel(p: SchoolSsoProvider): string {
  const named = p.settings.displayName?.trim();
  return p.kind === "oauth" && named ? `${named} (OpenID Connect)` : p.label;
}

/** What a domain may pick: the providers available to this school. */
export function pickableProviders(list: SchoolSsoProvider[]): SsoProvider[] {
  return list
    .filter((p) => p.available)
    .map((p) => ({ id: p.key, label: pickLabel(p), kind: p.kind }));
}

/** A select field's shown value: the draft's, or the default (first) option. */
export function selectValue(field: SignInSettingField, value: string | undefined): string {
  const options = field.options ?? [];
  return value && options.some((o) => o.value === value) ? value : (options[0]?.value ?? "");
}

/** What a select field keeps in the draft: the default is stored as empty. */
export function selectDraft(field: SignInSettingField, value: string): string {
  return value === field.options?.[0]?.value ? "" : value;
}

/** A switch field is on when its setting is "true". */
export function switchOn(value: string | undefined): boolean {
  return value === "true";
}

/** Not set up for this school, for the hint under a domain's picker. */
export function unavailableApps(list: SchoolSsoProvider[]): SchoolSsoProvider[] {
  return signInApps(list).filter((p) => !p.available);
}

/**
 * Nothing set up yet: no app of the school's own switched on and no domain
 * using a provider. Such a school signs in with email codes.
 */
export function usesEmailCodesOnly(
  providers: SchoolSsoProvider[],
  domains: Pick<EmailDomain, "ssoProvider">[],
): boolean {
  return (
    !providers.some((p) => p.configSource === "school" && p.enabled) &&
    !domains.some((d) => d.ssoProvider)
  );
}
