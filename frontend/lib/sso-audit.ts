/**
 * A school's single sign-on activity log (backend `src/sso/sso-audit.service.ts`):
 * `QUERY ${apiBase}/sso/audit` with `{ limit, before }` in the body, the active school's (`/schools/current`) or one
 * school's in the organisation console (`/organisation/schools/<id>`).
 * Entries never carry secrets: certificates are SHA-256 fingerprints and
 * client secrets only "set" / "cleared".
 */
import { apiQuery } from "@/lib/api";
import { CURRENT_SCHOOL_API } from "@/lib/organisation";

export type SsoAuditAction =
  | "domain_added"
  | "domain_removed"
  | "domain_verified"
  | "domain_settings_changed"
  | "provider_changed"
  | "sso_required_changed"
  | "saml_changed"
  | "azure_tenant_changed"
  | "app_changed"
  | "app_secret_changed"
  | "app_enabled"
  | "app_disabled";

export interface SsoAuditEntry {
  id: string;
  createdAt: string;
  action: SsoAuditAction;
  domain: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  actorVia: "school_admin" | "organisation_admin";
  changes: Record<string, unknown>;
}

/** Entries per page; the API's default. */
export const SSO_AUDIT_PAGE = 50;

export interface SsoAuditPage {
  before?: string;
  limit?: number;
}

/** The QUERY body for one page: `limit`, and `before` (the last entry's id) after the first. */
export function ssoAuditFilters(opts: SsoAuditPage = {}): { limit: number; before?: string } {
  const filters: { limit: number; before?: string } = { limit: opts.limit ?? SSO_AUDIT_PAGE };
  if (opts.before) filters.before = opts.before;
  return filters;
}

/** One page of the log, newest first. */
export function listSsoAudit(
  apiBase: string = CURRENT_SCHOOL_API,
  opts: SsoAuditPage = {},
): Promise<SsoAuditEntry[]> {
  return apiQuery<SsoAuditEntry[]>(`${apiBase}/sso/audit`, ssoAuditFilters(opts));
}

export const ACTION_LABEL: Record<SsoAuditAction, string> = {
  domain_added: "Domain added",
  domain_removed: "Domain removed",
  domain_verified: "Domain verified",
  domain_settings_changed: "Domain settings changed",
  provider_changed: "Sign-in provider changed",
  sso_required_changed: "Require SSO changed",
  saml_changed: "SAML connection changed",
  azure_tenant_changed: "Microsoft tenant changed",
  app_changed: "Sign-in app changed",
  app_secret_changed: "Client secret changed",
  app_enabled: "Sign-in app turned on",
  app_disabled: "Sign-in app turned off",
};

const FIELD_LABEL: Record<string, string> = {
  audience: "Who",
  autoJoin: "Auto-join",
  staffRole: "Staff role",
  ssoProvider: "Provider",
  ssoRequired: "Require SSO",
  azureTenantId: "Tenant ID",
  samlEntryPoint: "Sign-on URL",
  samlIssuer: "Entity ID",
  samlCertificate: "Certificate (SHA-256)",
  clientId: "Client ID",
  clientSecret: "Client secret",
  enabled: "On",
  settings: "Settings",
  verified: "Verified",
};

const APP_LABEL: Record<string, string> = { google: "Google", azure: "Microsoft", saml: "SAML" };

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isChange(v: unknown): v is { before: unknown; after: unknown } {
  return !!v && typeof v === "object" && "before" in v && "after" in v;
}

/** What the entry was about: its domain, or the sign-in app. */
export function auditSubject(e: SsoAuditEntry): string {
  if (e.domain) return e.domain;
  const app = typeof e.changes.app === "string" ? e.changes.app : null;
  return app ? `${APP_LABEL[app] ?? app} app` : "School";
}

/** "Provider: google → saml", one per field that changed. */
export function auditChanges(e: SsoAuditEntry): string[] {
  return Object.entries(e.changes)
    .filter(([, v]) => isChange(v))
    .map(([k, v]) => {
      const c = v as { before: unknown; after: unknown };
      return `${FIELD_LABEL[k] ?? k}: ${show(c.before)} → ${show(c.after)}`;
    });
}

/** Who made the change, as the table shows it. */
export function auditActor(e: SsoAuditEntry): string {
  if (!e.actor) return "System";
  return e.actor.name || e.actor.email || "Former user";
}
