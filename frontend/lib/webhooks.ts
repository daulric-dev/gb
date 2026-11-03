/**
 * Integrations (webhooks): wire types and helpers for a school's webhooks
 * (backend `src/integrations`). Routes live under `${apiBase}/webhooks`, the
 * active school's (`/schools/current`, school admins) or one school's in the
 * organisation console (`/organisation/schools/<id>`). The event type catalog
 * is `GET /webhooks/event-types`. A school may have several webhooks, each
 * with its own URL and event types.
 */
import { api, apiQuery } from "@/lib/api";
import { CURRENT_SCHOOL_API } from "@/lib/organisation";

export function webhooksApi(apiBase: string = CURRENT_SCHOOL_API): string {
  return `${apiBase}/webhooks`;
}

export const EVENT_TYPES_PATH = "/webhooks/event-types";

// ── wire types ───────────────────────────────────────────────────────────────

export type DeliveryStatus = "pending" | "succeeded" | "failed" | "abandoned";

/** A custom header: the name only; the value is write-only. */
export interface WebhookHeader {
  id: string;
  name: string;
  hasValue: true;
  /** The stored value no longer decrypts (the server's AUTH_SECRET changed): enter it again. */
  valueUnreadable: boolean;
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  insecure: boolean;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  hasSecret: boolean;
  secretUnreadable: boolean;
  /** Custom headers sent with every delivery (names only). */
  headers: WebhookHeader[];
  /** Certificate checks on https URLs; SHA-256 fingerprints of a trusted CA bundle. */
  tls: { verify: boolean; caFingerprints: string[] };
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastDelivery: {
    id: string;
    status: DeliveryStatus;
    eventType: string;
    createdAt: string;
    statusCode: number | null;
  } | null;
}

/**
 * Create and rotate-secret answers: a generated secret is in it this once.
 * A secret the admin entered is not echoed back (`secret` null).
 */
export interface WebhookWithSecret {
  webhook: Webhook;
  secret: string | null;
  secretGenerated: boolean;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  /** The last attempt checked the certificate: false when sent with verification off, null for http. */
  tlsVerified: boolean | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookDeliveryDetail extends WebhookDelivery {
  /** The body as sent: a WebhookPayload (deliveries made before the change may still hold the old shape). */
  payload: unknown;
  responseExcerpt: string | null;
}

/**
 * Every webhook POST body: exactly these three keys. The event id, school id,
 * API version, delivery id and timestamp travel as X-GradeBook-* headers;
 * `data` starts with `school: { id, name }`.
 */
export interface WebhookPayload {
  event_type: string;
  /** One plain-text sentence (at most 280 characters), e.g. for a chat channel. */
  message: string;
  data: Record<string, unknown>;
}

export interface WebhookEventType {
  key: string;
  group: string;
  label: string;
  description: string;
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
  /** The `message` the example's body carries. */
  exampleMessage: string;
}

export interface EventTypeCatalog {
  apiVersion: number;
  groups: { key: string; label: string }[];
  eventTypes: WebhookEventType[];
}

export type IntegrationAuditAction =
  | "webhook_created"
  | "webhook_updated"
  | "webhook_deleted"
  | "webhook_enabled"
  | "webhook_disabled"
  | "webhook_auto_disabled"
  | "secret_rotated"
  | "test_sent"
  | "delivery_redelivered"
  | "tls_verification_disabled"
  | "tls_verification_enabled"
  | "tls_ca_changed";

export interface IntegrationAuditEntry {
  id: string;
  createdAt: string;
  action: IntegrationAuditAction;
  webhookId: string | null;
  webhook: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  actorVia: "school_admin" | "organisation_admin" | "system";
  changes: Record<string, unknown>;
}

// ── event types ──────────────────────────────────────────────────────────────

/** Test pings are sent by the Test button only; nobody subscribes to them. */
export const SUBSCRIBABLE = (t: { key: string }) => t.key !== "ping";

/** The catalog's subscribable types under their groups, in catalog order; empty groups dropped. */
export function groupEventTypes(
  catalog: EventTypeCatalog,
): { key: string; label: string; types: WebhookEventType[] }[] {
  return catalog.groups
    .map((g) => ({
      ...g,
      types: catalog.eventTypes.filter((t) => t.group === g.key && SUBSCRIBABLE(t)),
    }))
    .filter((g) => g.types.length > 0);
}

/** Whether every, some or none of `keys` is selected (the group checkbox). */
export function groupState(selected: readonly string[], keys: readonly string[]): "all" | "some" | "none" {
  const n = keys.filter((k) => selected.includes(k)).length;
  if (n === 0) return "none";
  return n === keys.length ? "all" : "some";
}

/** Select or clear a whole group, keeping the rest. */
export function toggleGroup(selected: readonly string[], keys: readonly string[], on: boolean): string[] {
  const rest = selected.filter((k) => !keys.includes(k));
  return on ? [...rest, ...keys] : rest;
}

/** Select or clear one type. */
export function toggleEvent(selected: readonly string[], key: string, on: boolean): string[] {
  const rest = selected.filter((k) => k !== key);
  return on ? [...rest, key] : rest;
}

/** "3 events" / "All 17 events". */
export function eventsSummary(events: readonly string[], total: number): string {
  if (total > 0 && events.length >= total) return `All ${total} events`;
  return `${events.length} event${events.length === 1 ? "" : "s"}`;
}

// ── URLs ─────────────────────────────────────────────────────────────────────

/**
 * Why a URL cannot be saved, or null. Syntax only - like the API, any http(s)
 * URL is accepted, internal addresses included.
 */
export function urlProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the URL to send events to";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL, starting with https:// or http://";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "The URL must start with https:// or http://";
  }
  return null;
}

/** Plain http: payloads (names, emails, marks) travel unencrypted. */
export function isInsecureUrl(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith("http://");
}

// ── custom headers ───────────────────────────────────────────────────────────
// The same rules as the API (backend src/integrations/webhooks/webhook-headers.ts).

export const MAX_HEADERS = 20;
export const MAX_HEADER_NAME = 100;
export const MAX_HEADER_VALUE = 4096;
const RESERVED_HEADERS = new Set(["content-type", "content-length", "host", "user-agent", "transfer-encoding", "connection"]);

/** Why a header name can't be used, or null. Authorization is allowed. */
export function headerNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter a header name";
  if (name.length > MAX_HEADER_NAME) return `A header name can be at most ${MAX_HEADER_NAME} characters`;
  if (!/^[A-Za-z0-9-]+$/.test(name)) return `"${name}" is not a valid header name: use letters, digits and -`;
  const lower = name.toLowerCase();
  if (RESERVED_HEADERS.has(lower) || lower.startsWith("x-gradebook-")) {
    return `${name} is set by GradeBook and can't be replaced`;
  }
  return null;
}

/** Why a header value can't be used, or null. */
export function headerValueProblem(name: string, value: string): string | null {
  if (!value) return `Enter a value for ${name || "the header"}`;
  if (value.length > MAX_HEADER_VALUE) return `The value of ${name} can be at most ${MAX_HEADER_VALUE} characters`;
  if (!/^[\t\x20-\x7e]+$/.test(value)) {
    return `The value of ${name} can only use printable ASCII characters (no line breaks)`;
  }
  return null;
}

/** One row of the headers editor. `id` is a saved header's; `value` blank keeps it. */
export interface HeaderDraft {
  /** A stable React key (the saved id, or a new one). */
  key: string;
  id?: string;
  name: string;
  value: string;
}

let headerKeys = 0;
export function newHeaderDraft(): HeaderDraft {
  headerKeys += 1;
  return { key: `new-${headerKeys}`, name: "", value: "" };
}

/** Why the headers can't be saved, or null. */
export function headersProblem(rows: readonly HeaderDraft[]): string | null {
  if (rows.length > MAX_HEADERS) return `A webhook can have at most ${MAX_HEADERS} headers`;
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.name.trim();
    const p = headerNameProblem(name);
    if (p) return p;
    if (seen.has(name.toLowerCase())) return `${name} is listed twice`;
    seen.add(name.toLowerCase());
    if (!r.id || r.value) {
      const v = headerValueProblem(name, r.value);
      if (v) return v;
    }
  }
  return null;
}

/** The API's full desired list: saved ones by id (value only when replaced), new ones with a value. */
export function headersBody(rows: readonly HeaderDraft[]): { id?: string; name: string; value?: string }[] {
  return rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    name: r.name.trim(),
    ...(r.value ? { value: r.value } : {}),
  }));
}

/** Whether the rows differ from the saved headers (added, removed, renamed or a new value). */
export function headersChanged(saved: readonly WebhookHeader[], rows: readonly HeaderDraft[]): boolean {
  if (rows.length !== saved.length) return true;
  return rows.some((r) => {
    if (!r.id || r.value) return true;
    const s = saved.find((h) => h.id === r.id);
    return !s || s.name !== r.name.trim();
  });
}

/** "1 header" / "2 headers"; null for none. */
export function headersSummary(headers: readonly unknown[]): string | null {
  if (headers.length === 0) return null;
  return `${headers.length} header${headers.length === 1 ? "" : "s"}`;
}

// ── signing secret ───────────────────────────────────────────────────────────

/** Why an own signing secret can't be used, or null (16-256 printable ASCII, no edge spaces). */
export function customSecretProblem(raw: string): string | null {
  if (raw.length < 16 || raw.length > 256) return "A signing secret must be 16-256 characters";
  if (!/^[\x20-\x7e]+$/.test(raw)) return "A signing secret can only use printable ASCII characters";
  if (raw.trim() !== raw) return "A signing secret cannot start or end with a space";
  return null;
}

/** The rotate-secret body: the own secret when one is entered. */
export function rotateBody(ownSecret: string): { signingSecret?: string } {
  return ownSecret ? { signingSecret: ownSecret } : {};
}

// ── forms ────────────────────────────────────────────────────────────────────

export interface WebhookDraft {
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  headers: HeaderDraft[];
  /** New webhooks only: the admin's own signing secret; blank = generate one. */
  signingSecret: string;
  /** Verify the receiver's SSL/TLS certificate (https). */
  tlsVerify: boolean;
  /**
   * A new trusted CA bundle (PEM). Blank keeps the saved one (the PEM is not
   * sent back, only fingerprints); `clearCa` removes it.
   */
  tlsCaCert: string;
  clearCa: boolean;
}

export function draftOf(w: Webhook | null): WebhookDraft {
  return w
    ? {
        name: w.name,
        url: w.url,
        events: [...w.events],
        enabled: w.enabled,
        headers: w.headers.map((h) => ({ key: h.id, id: h.id, name: h.name, value: "" })),
        signingSecret: "",
        tlsVerify: w.tls.verify,
        tlsCaCert: "",
        clearCa: false,
      }
    : {
        name: "",
        url: "",
        events: [],
        enabled: true,
        headers: [],
        signingSecret: "",
        tlsVerify: true,
        tlsCaCert: "",
        clearCa: false,
      };
}

export interface WebhookBody {
  name?: string;
  url?: string;
  events?: string[];
  enabled?: boolean;
  headers?: { id?: string; name: string; value?: string }[];
  signingSecret?: string;
  tls?: { verify?: boolean; caCert?: string };
}

/** The POST body for a new webhook. */
export function createBody(d: WebhookDraft): WebhookBody {
  return {
    name: d.name.trim(),
    url: d.url.trim(),
    events: d.events,
    enabled: d.enabled,
    ...(d.headers.length ? { headers: headersBody(d.headers) } : {}),
    ...(d.signingSecret ? { signingSecret: d.signingSecret } : {}),
    ...(!d.tlsVerify || d.tlsCaCert.trim()
      ? { tls: { verify: d.tlsVerify, ...(d.tlsCaCert.trim() ? { caCert: d.tlsCaCert.trim() } : {}) } }
      : {}),
  };
}

/** The PATCH body: only what changed; null when nothing did. */
export function webhookPatch(w: Webhook, d: WebhookDraft): WebhookBody | null {
  const out: WebhookBody = {};
  if (d.name.trim() !== w.name) out.name = d.name.trim();
  if (d.url.trim() !== w.url) out.url = d.url.trim();
  const same = d.events.length === w.events.length && d.events.every((e) => w.events.includes(e));
  if (!same) out.events = d.events;
  if (d.enabled !== w.enabled) out.enabled = d.enabled;
  if (headersChanged(w.headers, d.headers)) out.headers = headersBody(d.headers);
  const tls: NonNullable<WebhookBody["tls"]> = {};
  if (d.tlsVerify !== w.tls.verify) tls.verify = d.tlsVerify;
  if (d.tlsCaCert.trim()) tls.caCert = d.tlsCaCert.trim();
  else if (d.clearCa && w.tls.caFingerprints.length) tls.caCert = "";
  if (Object.keys(tls).length) out.tls = tls;
  return Object.keys(out).length ? out : null;
}

/** Why the draft cannot be saved, or null. */
export function draftProblem(d: WebhookDraft): string | null {
  if (!d.name.trim()) return "Give the webhook a name";
  const url = urlProblem(d.url);
  if (url) return url;
  if (d.events.length === 0) return "Choose at least one event";
  const headers = headersProblem(d.headers);
  if (headers) return headers;
  const ca = caCertProblem(d.tlsCaCert);
  if (ca) return ca;
  if (d.signingSecret) return customSecretProblem(d.signingSecret);
  return null;
}

// ── TLS ──────────────────────────────────────────────────────────────────────

/** The same cap as the server's (64 KB). */
export const MAX_CA_BYTES = 64 * 1024;

/**
 * A quick check of a pasted CA bundle (the server parses each certificate):
 * blank is fine (nothing to change); otherwise PEM certificates only.
 */
export function caCertProblem(raw: string): string | null {
  const pem = raw.trim();
  if (!pem) return null;
  if (new TextEncoder().encode(pem).length > MAX_CA_BYTES) return "The CA certificate can be at most 64 KB";
  if (/PRIVATE KEY-----/.test(pem)) return "That contains a private key: paste only the CA certificate (never a key)";
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const rest = pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim();
  if (blocks.length === 0 || rest) {
    return "Paste one or more PEM certificates (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----)";
  }
  return null;
}

/** The list row's TLS badge: only when verification is off on an https URL. */
export function tlsBadge(w: Pick<Webhook, "url" | "tls">): string | null {
  return !w.tls.verify && !isInsecureUrl(w.url) ? "TLS not verified" : null;
}

// ── deliveries ───────────────────────────────────────────────────────────────

export const DELIVERY_PAGE = 50;

export interface DeliveryFilters {
  status?: DeliveryStatus | "";
  eventType?: string;
  before?: string;
  limit?: number;
}

/** The QUERY body: only the filters in use. */
export function deliveryFilters(f: DeliveryFilters = {}): Record<string, string | number> {
  const out: Record<string, string | number> = { limit: f.limit ?? DELIVERY_PAGE };
  if (f.status) out.status = f.status;
  if (f.eventType) out.eventType = f.eventType;
  if (f.before) out.before = f.before;
  return out;
}

export function listDeliveries(
  apiBase: string | undefined,
  webhookId: string,
  f: DeliveryFilters = {},
  signal?: AbortSignal,
) {
  return apiQuery<WebhookDelivery[]>(
    `${webhooksApi(apiBase)}/${webhookId}/deliveries`,
    deliveryFilters(f),
    signal ? { signal } : {},
  );
}

export function getDelivery(apiBase: string | undefined, deliveryId: string) {
  return api<WebhookDeliveryDetail>(`${webhooksApi(apiBase)}/deliveries/${deliveryId}`);
}

/** The `message` of a delivery's payload, or null (an old-shape payload has none). */
export function payloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const m = (payload as Partial<WebhookPayload>).message;
  return typeof m === "string" && m ? m : null;
}

/**
 * The GradeBook headers a delivery was sent with, minus the signature and
 * timestamp (per attempt, not stored), for the delivery viewer.
 */
export function deliveryHeaders(
  d: Pick<WebhookDelivery, "id" | "eventId" | "eventType">,
  schoolId: string | null,
): [string, string][] {
  const rows: [string, string][] = [
    ["X-GradeBook-Event", d.eventType],
    ["X-GradeBook-Event-Id", d.eventId],
  ];
  if (schoolId) rows.push(["X-GradeBook-School-Id", schoolId]);
  rows.push(["X-GradeBook-Api-Version", "1"], ["X-GradeBook-Delivery", d.id]);
  return rows;
}

/** The school id in a payload's data (`data.school.id`), or null. */
export function payloadSchoolId(payload: unknown): string | null {
  const data = (payload as { data?: { school?: { id?: unknown } } } | null)?.data;
  const id = data?.school?.id;
  return typeof id === "string" ? id : null;
}

export const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; tone: "ok" | "warn" | "bad" | "off" }> = {
  pending: { label: "Retrying", tone: "warn" },
  succeeded: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  abandoned: { label: "Gave up", tone: "bad" },
};

/** "Delivered", "Retrying (attempt 2 of 8)", "Gave up after 8 attempts". */
export function deliveryStatusText(d: Pick<WebhookDelivery, "status" | "attempts" | "maxAttempts">): string {
  if (d.status === "pending") {
    return d.attempts === 0 ? "Queued" : `Retrying (${d.attempts} of ${d.maxAttempts} attempts made)`;
  }
  if (d.status === "abandoned") {
    return d.attempts === 0 ? "Not sent" : `Gave up after ${d.attempts} attempt${d.attempts === 1 ? "" : "s"}`;
  }
  return DELIVERY_STATUS[d.status].label;
}

// ── activity log ─────────────────────────────────────────────────────────────

export const AUDIT_PAGE = 50;

export function listIntegrationAudit(apiBase: string | undefined, before?: string) {
  return apiQuery<IntegrationAuditEntry[]>(`${webhooksApi(apiBase)}/audit`, {
    limit: AUDIT_PAGE,
    ...(before ? { before } : {}),
  });
}

export const AUDIT_ACTION_LABEL: Record<IntegrationAuditAction, string> = {
  webhook_created: "Webhook added",
  webhook_updated: "Webhook changed",
  webhook_deleted: "Webhook deleted",
  webhook_enabled: "Webhook turned on",
  webhook_disabled: "Webhook turned off",
  webhook_auto_disabled: "Switched off after repeated failures",
  secret_rotated: "Signing secret rotated",
  test_sent: "Test sent",
  delivery_redelivered: "Delivery sent again",
  tls_verification_disabled: "TLS verification turned off",
  tls_verification_enabled: "TLS verification turned on",
  tls_ca_changed: "Trusted CA certificate changed",
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  url: "URL",
  events: "Events",
  enabled: "On",
  disabledReason: "Switched off because",
  verifyTls: "Verify TLS",
};

/** "2 certificates (AB:CD:EF…, 12:34:56…)" or "none". */
function showCerts(value: unknown): string {
  const list = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  if (list.length === 0) return "none";
  const short = list.map((f) => `${f.slice(0, 8)}…`).join(", ");
  return `${list.length} certificate${list.length === 1 ? "" : "s"} (${short})`;
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return `${value.length} event${value.length === 1 ? "" : "s"}`;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Header changes, by name (the log never holds a value). */
function headerChanges(v: unknown): string[] {
  if (!v || typeof v !== "object") return [];
  const c = v as {
    added?: string[];
    removed?: string[];
    renamed?: { before: string; after: string }[];
    valueChanged?: string[];
  };
  const out: string[] = [];
  if (c.added?.length) out.push(`Header added: ${c.added.join(", ")}`);
  if (c.removed?.length) out.push(`Header removed: ${c.removed.join(", ")}`);
  for (const r of c.renamed ?? []) out.push(`Header renamed: ${r.before} → ${r.after}`);
  if (c.valueChanged?.length) out.push(`Header value changed: ${c.valueChanged.join(", ")}`);
  return out;
}

/** "URL: https://a → https://b", one per field that changed; header changes by name. */
export function integrationAuditChanges(e: IntegrationAuditEntry): string[] {
  const fields = Object.entries(e.changes)
    .filter(([, v]) => !!v && typeof v === "object" && "before" in v && "after" in v)
    .map(([k, v]) => {
      const c = v as { before: unknown; after: unknown };
      if (k === "caFingerprints") return `Trusted CA: ${showCerts(c.before)} → ${showCerts(c.after)}`;
      return `${FIELD_LABEL[k] ?? k}: ${show(c.before)} → ${show(c.after)}`;
    });
  const extra = headerChanges(e.changes.headers);
  if (e.changes.customSigningSecret === true) extra.push("Own signing secret used");
  if (Array.isArray(e.changes.tlsCaFingerprints)) extra.push(`Trusted CA: ${showCerts(e.changes.tlsCaFingerprints)}`);
  return [...fields, ...extra];
}

export function integrationAuditActor(e: IntegrationAuditEntry): string {
  if (e.actorVia === "system" || !e.actor) return "GradeBook";
  return e.actor.name || e.actor.email || "Former user";
}
