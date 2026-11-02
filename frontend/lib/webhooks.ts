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

/** Create and rotate-secret answers: the secret is in it this once. */
export interface WebhookWithSecret {
  webhook: Webhook;
  secret: string;
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
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookDeliveryDetail extends WebhookDelivery {
  payload: unknown;
  responseExcerpt: string | null;
}

export interface WebhookEventType {
  key: string;
  group: string;
  label: string;
  description: string;
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
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
  | "delivery_redelivered";

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

// ── forms ────────────────────────────────────────────────────────────────────

export interface WebhookDraft {
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
}

export function draftOf(w: Webhook | null): WebhookDraft {
  return w
    ? { name: w.name, url: w.url, events: [...w.events], enabled: w.enabled }
    : { name: "", url: "", events: [], enabled: true };
}

/** The PATCH body: only what changed; null when nothing did. */
export function webhookPatch(w: Webhook, d: WebhookDraft): Partial<WebhookDraft> | null {
  const out: Partial<WebhookDraft> = {};
  if (d.name.trim() !== w.name) out.name = d.name.trim();
  if (d.url.trim() !== w.url) out.url = d.url.trim();
  const same = d.events.length === w.events.length && d.events.every((e) => w.events.includes(e));
  if (!same) out.events = d.events;
  if (d.enabled !== w.enabled) out.enabled = d.enabled;
  return Object.keys(out).length ? out : null;
}

/** Why the draft cannot be saved, or null. */
export function draftProblem(d: WebhookDraft): string | null {
  if (!d.name.trim()) return "Give the webhook a name";
  const url = urlProblem(d.url);
  if (url) return url;
  if (d.events.length === 0) return "Choose at least one event";
  return null;
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

export function listDeliveries(apiBase: string | undefined, webhookId: string, f: DeliveryFilters = {}) {
  return apiQuery<WebhookDelivery[]>(`${webhooksApi(apiBase)}/${webhookId}/deliveries`, deliveryFilters(f));
}

export function getDelivery(apiBase: string | undefined, deliveryId: string) {
  return api<WebhookDeliveryDetail>(`${webhooksApi(apiBase)}/deliveries/${deliveryId}`);
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
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  url: "URL",
  events: "Events",
  enabled: "On",
  disabledReason: "Switched off because",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return `${value.length} event${value.length === 1 ? "" : "s"}`;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** "URL: https://a → https://b", one per field that changed. */
export function integrationAuditChanges(e: IntegrationAuditEntry): string[] {
  return Object.entries(e.changes)
    .filter(([, v]) => !!v && typeof v === "object" && "before" in v && "after" in v)
    .map(([k, v]) => {
      const c = v as { before: unknown; after: unknown };
      return `${FIELD_LABEL[k] ?? k}: ${show(c.before)} → ${show(c.after)}`;
    });
}

export function integrationAuditActor(e: IntegrationAuditEntry): string {
  if (e.actorVia === "system" || !e.actor) return "GradeBook";
  return e.actor.name || e.actor.email || "Former user";
}
