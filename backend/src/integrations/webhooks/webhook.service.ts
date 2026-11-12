import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  expandEvents,
  UnknownEventTypeError,
} from '@/integrations/events/webhook-event-types';
import {
  customSecretProblem,
  decryptWebhookHeaderValue,
  decryptWebhookSecret,
  encryptWebhookHeaderValue,
  encryptWebhookSecret,
  generateWebhookSecret,
} from '@/integrations/webhooks/webhook-secret';
import {
  headerPlanIsEmpty,
  planHeaders,
  type HeaderPlan,
  type WebhookHeaderInput,
} from '@/integrations/webhooks/webhook-headers';
import {
  IntegrationAuditService,
  type IntegrationActor,
  type IntegrationAuditEntry,
} from '@/integrations/audit/integration-audit.service';
import {
  WebhookDeliveryService,
  type DeliveryStatus,
} from '@/integrations/delivery/webhook-delivery.service';
import { buildEnvelope, toEnvelope } from '@/integrations/events/webhook-envelope';
import { maxAttempts } from '@/integrations/config/webhook.config';
import { WebhookAlertService } from '@/integrations/alerts/webhook-alert.service';
import { caFingerprints, parseCaBundle } from '@/integrations/webhooks/webhook-tls';
import {
  DELIVERIES_DEFAULT_LIMIT,
  DELIVERIES_MAX_LIMIT,
  MAX_NAME,
  MAX_URL,
} from '@/integrations/webhooks/dto/webhook.dto';

/** A custom header as admins see it: the name only, never the value. */
export interface WebhookHeaderItem {
  id: string;
  name: string;
  /** Always true: a saved header always has a value. Never returned itself. */
  hasValue: true;
  /** The stored value no longer decrypts (AUTH_SECRET changed): enter it again. */
  valueUnreadable: boolean;
}

/** A webhook as admins see it. Never the secret, never a header value. */
export interface WebhookItem {
  id: string;
  name: string;
  url: string;
  /** Plain http: the UI warns that payloads travel unencrypted. */
  insecure: boolean;
  events: string[];
  enabled: boolean;
  /** Why it is off when the system switched it off; null otherwise. */
  disabledReason: string | null;
  consecutiveFailures: number;
  /** Always true: a webhook always has a signing secret. Never returned itself. */
  hasSecret: boolean;
  /** The stored secret no longer decrypts (AUTH_SECRET changed): rotate it. */
  secretUnreadable: boolean;
  /** Custom headers sent with every delivery, in the order they were added. */
  headers: WebhookHeaderItem[];
  /**
   * Certificate checks on https URLs: `verify` false means deliveries can be
   * intercepted; `caFingerprints` (SHA-256) of a trusted CA bundle, if any.
   */
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
 * Create and rotate answer with a generated secret, the only time it is
 * shown. A secret the school supplied is not echoed back: `secret` is null
 * and `secretGenerated` false.
 */
export interface WebhookWithSecret {
  webhook: WebhookItem;
  secret: string | null;
  secretGenerated: boolean;
}

export interface DeliveryItem {
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
  /** The last attempt checked the certificate; false when sent with verification off, null for http. */
  tlsVerified: boolean | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface DeliveryDetail extends DeliveryItem {
  payload: unknown;
  responseExcerpt: string | null;
}

export interface WebhookInput {
  name: string;
  url: string;
  events: string[];
  enabled?: boolean;
  /** Custom headers; values write-only. */
  headers?: WebhookHeaderInput[];
  /** The school's own signing secret; generated when omitted. */
  signingSecret?: string;
  /** Certificate checks: `verify` (default true), `caCert` PEM bundle ('' clears). */
  tls?: WebhookTlsInput;
}

export interface WebhookTlsInput {
  verify?: boolean;
  caCert?: string;
}

export type WebhookPatch = Partial<Omit<WebhookInput, 'signingSecret'>>;

const WEBHOOK_SELECT = {
  id: true,
  school_id: true,
  name: true,
  url: true,
  secret_enc: true,
  event_subscriptions: {
    select: { event_type: true },
    orderBy: { event_type: 'asc' },
  },
  enabled: true,
  consecutive_failures: true,
  disabled_reason: true,
  verify_tls: true,
  tls_ca_cert: true,
  created_by: true,
  created_at: true,
  updated_at: true,
  headers: {
    select: { id: true, name: true, value_enc: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.school_webhookSelect;

type WebhookRow = Prisma.school_webhookGetPayload<{ select: typeof WEBHOOK_SELECT }>;

function eventTypes(row: WebhookRow): string[] {
  return expandEvents(row.event_subscriptions.map(({ event_type }) => event_type));
}

const DELIVERY_SELECT = {
  id: true,
  webhook_id: true,
  school_id: true,
  event_id: true,
  event_type: true,
  status: true,
  attempts: true,
  next_attempt_at: true,
  last_status_code: true,
  last_error: true,
  duration_ms: true,
  tls_verified: true,
  created_at: true,
  delivered_at: true,
} satisfies Prisma.webhook_deliverySelect;

type DeliveryRow = Prisma.webhook_deliveryGetPayload<{ select: typeof DELIVERY_SELECT }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A webhook URL's syntax is checked here: https, or http only with
 * WEBHOOK_ALLOW_PRIVATE=true. Its resolved address is checked and pinned at
 * send time, with private destinations opt-in for trusted installs. Returns
 * the normalised URL.
 */
export function normaliseWebhookUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new BadRequestException('Enter the URL to send events to');
  if (value.length > MAX_URL) {
    throw new BadRequestException(`The URL can be at most ${MAX_URL} characters`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Enter a full URL, starting with https:// or http://');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('The URL must start with https:// or http://');
  }
  // Payloads carry personal data (names, grades, attendance): plain http only
  // where the install opted into private destinations (a trusted network).
  if (url.protocol === 'http:' && process.env.WEBHOOK_ALLOW_PRIVATE !== 'true') {
    throw new BadRequestException(
      'The URL must start with https://. Plain http:// is only allowed when the server sets WEBHOOK_ALLOW_PRIVATE=true.',
    );
  }
  if (!url.hostname) throw new BadRequestException('The URL needs a host name');
  url.hash = '';
  return url.toString();
}

function normaliseName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new BadRequestException('Give the webhook a name');
  if (name.length > MAX_NAME) {
    throw new BadRequestException(`The name can be at most ${MAX_NAME} characters`);
  }
  return name;
}

function normaliseEvents(raw: string[]): string[] {
  let events: string[];
  try {
    events = expandEvents(raw);
  } catch (err) {
    if (err instanceof UnknownEventTypeError) {
      throw new BadRequestException(`Unknown event type "${err.eventType}"`);
    }
    throw err;
  }
  if (events.length === 0) throw new BadRequestException('Choose at least one event');
  return events;
}

/** The signing secret to store: the school's own (checked) or a new one. */
function signingSecretOf(raw: string | undefined): { secret: string; generated: boolean } {
  if (raw === undefined || raw === '') return { secret: generateWebhookSecret(), generated: true };
  const problem = customSecretProblem(raw);
  if (problem) throw new BadRequestException(problem);
  return { secret: raw, generated: false };
}

/** A CA bundle as entered: '' (or blank) clears it; else parsed and normalised (400 if bad). */
function caBundleOf(raw: string | undefined): { pem: string | null; fingerprints: string[] } | undefined {
  if (raw === undefined) return undefined;
  if (!raw.trim()) return { pem: null, fingerprints: [] };
  return parseCaBundle(raw);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * A school's webhooks: list, create, change, delete, rotate the secret, send
 * a test, and their deliveries. Shared by the school admin's routes
 * (`/schools/current/webhooks`) and the organisation console's
 * (`/organisation/schools/:schoolId/webhooks`); callers check who may touch
 * which school and that integrations are on. Every change, test and
 * redelivery is written to the integrations audit log in the same
 * transaction. A school may have several webhooks, each with its own URL and
 * event types, to route different events to different systems.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: IntegrationAuditService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly alerts: WebhookAlertService,
  ) {}

  // ── webhooks ──────────────────────────────────────────────────────────────

  async list(schoolId: string): Promise<WebhookItem[]> {
    const rows = await this.prisma.school_webhook.findMany({
      where: { school_id: schoolId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: WEBHOOK_SELECT,
    });
    const last = await this.lastDeliveries(rows.map((r) => r.id));
    return rows.map((r) => this.toItem(r, last.get(r.id) ?? null));
  }

  async get(schoolId: string, id: string): Promise<WebhookItem> {
    const row = await this.require(schoolId, id);
    const last = await this.lastDeliveries([id]);
    return this.toItem(row, last.get(id) ?? null);
  }

  async create(
    schoolId: string,
    input: WebhookInput,
    actor: IntegrationActor,
  ): Promise<WebhookWithSecret> {
    const name = normaliseName(input.name);
    const url = normaliseWebhookUrl(input.url);
    const events = normaliseEvents(input.events);
    const enabled = input.enabled ?? true;
    const headers = planHeaders([], input.headers ?? []);
    const verifyTls = input.tls?.verify ?? true;
    const ca = caBundleOf(input.tls?.caCert);
    const id = randomUUID();
    const { secret, generated } = signingSecretOf(input.signingSecret);
    const secretEnc = encryptWebhookSecret({ schoolId, webhookId: id }, secret);

    let row: WebhookRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.school_webhook.create({
          data: {
            id,
            school_id: schoolId,
            name,
            url,
            secret_enc: secretEnc,
            event_subscriptions: { create: events.map((event_type) => ({ event_type })) },
            enabled,
            verify_tls: verifyTls,
            tls_ca_cert: ca?.pem ?? null,
            created_by: actor.id,
            ...(headers.create.length
              ? {
                  headers: {
                    create: headers.create.map((h) => ({
                      id: h.id,
                      name: h.name,
                      value_enc: encryptWebhookHeaderValue({ schoolId, webhookId: id, headerId: h.id }, h.value),
                    })),
                  },
                }
              : {}),
          },
          select: WEBHOOK_SELECT,
        });
        await this.audit.record(tx, schoolId, actor, [
          {
            action: 'webhook_created',
            webhookId: id,
            webhook: name,
            changes: {
              name,
              url,
              events,
              enabled,
              ...(headers.changes.added ? { headers: { added: headers.changes.added } } : {}),
              ...(generated ? {} : { customSigningSecret: true }),
              ...(ca?.pem ? { tlsCaFingerprints: ca.fingerprints } : {}),
            },
          },
          ...(verifyTls
            ? []
            : [
                {
                  action: 'tls_verification_disabled' as const,
                  webhookId: id,
                  webhook: name,
                  changes: { verifyTls: { before: null, after: false } },
                },
              ]),
        ]);
        return created;
      });
    } catch (err) {
      this.logger.error(`Failed to create a webhook for school ${schoolId}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create the webhook');
    }
    this.logger.log(`User ${actor.id} created webhook ${id} for school ${schoolId}`);
    if (!verifyTls) this.alertTlsOff(schoolId, id, name);
    return { webhook: this.toItem(row, null), secret: generated ? secret : null, secretGenerated: generated };
  }

  async update(
    schoolId: string,
    id: string,
    patch: WebhookPatch,
    actor: IntegrationActor,
  ): Promise<WebhookItem> {
    if (
      patch.name === undefined &&
      patch.url === undefined &&
      patch.events === undefined &&
      patch.enabled === undefined &&
      patch.headers === undefined &&
      patch.tls?.verify === undefined &&
      patch.tls?.caCert === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }
    const before = await this.require(schoolId, id);
    const data: Prisma.school_webhookUpdateInput = {};
    const changes: Record<string, unknown> = {};

    if (patch.name !== undefined) {
      const name = normaliseName(patch.name);
      if (name !== before.name) {
        data.name = name;
        changes.name = { before: before.name, after: name };
      }
    }
    if (patch.url !== undefined) {
      const url = normaliseWebhookUrl(patch.url);
      if (url !== before.url) {
        data.url = url;
        changes.url = { before: before.url, after: url };
      }
    }
    if (patch.events !== undefined) {
      const events = normaliseEvents(patch.events);
      const beforeEvents = eventTypes(before);
      if (JSON.stringify(events) !== JSON.stringify(beforeEvents)) {
        changes.events = { before: beforeEvents, after: events };
      }
    }
    // Validated before anything is written; values never reach the audit log.
    let headers: HeaderPlan | null = null;
    if (patch.headers !== undefined) {
      headers = planHeaders(before.headers, patch.headers);
      if (headerPlanIsEmpty(headers)) headers = null;
      else changes.headers = headers.changes;
    }
    const entries: IntegrationAuditEntry[] = [];
    const name = (data.name as string | undefined) ?? before.name;
    if (patch.enabled !== undefined && patch.enabled !== before.enabled) {
      data.enabled = patch.enabled;
      if (patch.enabled) {
        // Back on: a fresh start, whatever switched it off.
        data.consecutive_failures = 0;
        data.disabled_reason = null;
      }
      entries.push({
        action: patch.enabled ? 'webhook_enabled' : 'webhook_disabled',
        webhookId: id,
        webhook: name,
        changes: {
          enabled: { before: before.enabled, after: patch.enabled },
          ...(patch.enabled && before.disabled_reason
            ? { disabledReason: { before: before.disabled_reason, after: null } }
            : {}),
        },
      });
    }
    // TLS: each change is its own entry (off is the one that matters); the
    // audit gets CA fingerprints, never the PEM.
    const tlsOff = patch.tls?.verify === false && before.verify_tls;
    if (patch.tls?.verify !== undefined && patch.tls.verify !== before.verify_tls) {
      data.verify_tls = patch.tls.verify;
      entries.push({
        action: patch.tls.verify ? 'tls_verification_enabled' : 'tls_verification_disabled',
        webhookId: id,
        webhook: name,
        changes: { verifyTls: { before: before.verify_tls, after: patch.tls.verify } },
      });
    }
    const ca = caBundleOf(patch.tls?.caCert);
    if (ca && ca.pem !== before.tls_ca_cert) {
      data.tls_ca_cert = ca.pem;
      entries.push({
        action: 'tls_ca_changed',
        webhookId: id,
        webhook: name,
        changes: { caFingerprints: { before: caFingerprints(before.tls_ca_cert), after: ca.fingerprints } },
      });
    }
    if (Object.keys(changes).length) {
      entries.unshift({ action: 'webhook_updated', webhookId: id, webhook: name, changes });
    }
    if (entries.length === 0) return this.get(schoolId, id);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.school_webhook.update({
          where: { id },
          data: { ...data, updated_at: new Date() },
        });
        if (patch.events !== undefined && changes.events) {
          await tx.school_webhook_event.deleteMany({ where: { webhook_id: id } });
          await tx.school_webhook_event.createMany({
            data: normaliseEvents(patch.events).map((event_type) => ({ webhook_id: id, event_type })),
          });
        }
        if (headers) await this.writeHeaders(tx, schoolId, id, headers);
        await this.audit.record(tx, schoolId, actor, entries);
      });
    } catch (err) {
      this.logger.error(`Failed to update webhook ${id}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update the webhook');
    }
    if (tlsOff) this.alertTlsOff(schoolId, id, name);
    return this.get(schoolId, id);
  }

  async remove(schoolId: string, id: string, actor: IntegrationActor): Promise<void> {
    const before = await this.require(schoolId, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        // Its deliveries go with it (cascade).
        await tx.school_webhook.delete({ where: { id } });
        await this.audit.record(tx, schoolId, actor, [
          {
            action: 'webhook_deleted',
            webhookId: id,
            webhook: before.name,
            changes: { url: before.url, events: eventTypes(before) },
          },
        ]);
      });
    } catch (err) {
      this.logger.error(`Failed to delete webhook ${id}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to delete the webhook');
    }
  }

  /**
   * A new signing secret, in effect at once: the old one stops working
   * immediately, so update the receiver straight after. Shown once.
   */
  async rotateSecret(
    schoolId: string,
    id: string,
    actor: IntegrationActor,
    signingSecret?: string,
  ): Promise<WebhookWithSecret> {
    const before = await this.require(schoolId, id);
    const { secret, generated } = signingSecretOf(signingSecret);
    const secretEnc = encryptWebhookSecret({ schoolId, webhookId: id }, secret);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.school_webhook.update({
          where: { id },
          data: { secret_enc: secretEnc, updated_at: new Date() },
        });
        await this.audit.record(tx, schoolId, actor, [
          {
            action: 'secret_rotated',
            webhookId: id,
            webhook: before.name,
            changes: generated ? {} : { customSigningSecret: true },
          },
        ]);
      });
    } catch (err) {
      this.logger.error(`Failed to rotate webhook ${id}'s secret: ${(err as Error).message}`);
      throw new BadRequestException('Failed to rotate the secret');
    }
    return {
      webhook: await this.get(schoolId, id),
      secret: generated ? secret : null,
      secretGenerated: generated,
    };
  }

  /**
   * Send a `ping` to the webhook now, whatever it subscribes to and even
   * while it is switched off. Not retried; does not count towards
   * auto-disable. Returns the delivery with its outcome.
   */
  async test(schoolId: string, id: string, actor: IntegrationActor): Promise<DeliveryDetail> {
    const hook = await this.require(schoolId, id);
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true },
    });
    const eventId = randomUUID();
    const envelope = buildEnvelope('ping', {
      school: { id: schoolId, name: school?.name ?? '' },
      webhook: { id, name: hook.name },
    });
    const deliveryId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhook_delivery.create({
        data: {
          webhook_id: id,
          school_id: schoolId,
          event_id: eventId,
          event_type: 'ping',
          payload: envelope as unknown as Prisma.InputJsonValue,
          status: 'pending',
          next_attempt_at: null,
        },
        select: { id: true },
      });
      await this.audit.record(tx, schoolId, actor, [
        { action: 'test_sent', webhookId: id, webhook: hook.name, changes: { deliveryId: created.id } },
      ]);
      return created.id;
    });
    await this.deliveries.sendNow(deliveryId);
    return this.delivery(schoolId, deliveryId);
  }

  // ── deliveries ────────────────────────────────────────────────────────────

  async listDeliveries(
    schoolId: string,
    webhookId: string,
    filters: { status?: DeliveryStatus; eventType?: string; limit?: number; before?: string } = {},
  ): Promise<DeliveryItem[]> {
    await this.require(schoolId, webhookId);
    const limit = Math.min(Math.max(filters.limit ?? DELIVERIES_DEFAULT_LIMIT, 1), DELIVERIES_MAX_LIMIT);
    const base: Prisma.webhook_deliveryWhereInput = {
      webhook_id: webhookId,
      school_id: schoolId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.eventType ? { event_type: filters.eventType } : {}),
    };
    let where = base;
    if (filters.before) {
      if (!UUID.test(filters.before)) throw new BadRequestException('Invalid cursor');
      const cursor = await this.prisma.webhook_delivery.findFirst({
        where: { id: filters.before, webhook_id: webhookId },
        select: { id: true, created_at: true },
      });
      if (!cursor) throw new BadRequestException('Invalid cursor');
      where = {
        ...base,
        OR: [
          { created_at: { lt: cursor.created_at } },
          { created_at: cursor.created_at, id: { lt: cursor.id } },
        ],
      };
    }
    const rows = await this.prisma.webhook_delivery.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
      select: DELIVERY_SELECT,
    });
    return rows.map((r) => this.toDelivery(r));
  }

  /** One delivery with its payload and the receiver's last response excerpt. */
  async delivery(schoolId: string, deliveryId: string): Promise<DeliveryDetail> {
    const row = await this.prisma.webhook_delivery.findFirst({
      where: { id: deliveryId, school_id: schoolId },
      select: { ...DELIVERY_SELECT, payload: true, response_excerpt: true },
    });
    if (!row) throw new NotFoundException('Delivery not found');
    return {
      ...this.toDelivery(row),
      payload: row.payload,
      responseExcerpt: row.response_excerpt,
    };
  }

  /**
   * Send a past delivery's payload again, now, as a new delivery with the
   * same event id (receivers that already handled it can skip it). Not
   * retried; works while the webhook is switched off, to check a fix. A
   * payload stored in the old `{ id, type, apiVersion, createdAt, school,
   * data }` shape is converted to `{ event_type, message, data }` (school
   * moved into data) and stored converted.
   */
  async redeliver(
    schoolId: string,
    deliveryId: string,
    actor: IntegrationActor,
  ): Promise<DeliveryDetail> {
    const original = await this.prisma.webhook_delivery.findFirst({
      where: { id: deliveryId, school_id: schoolId },
      select: {
        id: true,
        webhook_id: true,
        event_id: true,
        event_type: true,
        payload: true,
        webhook: { select: { name: true } },
      },
    });
    if (!original) throw new NotFoundException('Delivery not found');
    const newId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhook_delivery.create({
        data: {
          webhook_id: original.webhook_id,
          school_id: schoolId,
          event_id: original.event_id,
          event_type: original.event_type,
          payload: toEnvelope(original.payload, original.event_type).envelope as unknown as Prisma.InputJsonValue,
          status: 'pending',
          next_attempt_at: null,
        },
        select: { id: true },
      });
      await this.audit.record(tx, schoolId, actor, [
        {
          action: 'delivery_redelivered',
          webhookId: original.webhook_id,
          webhook: original.webhook.name,
          changes: {
            deliveryId: original.id,
            newDeliveryId: created.id,
            eventType: original.event_type,
            eventId: original.event_id,
          },
        },
      ]);
      return created.id;
    });
    await this.deliveries.sendNow(newId);
    return this.delivery(schoolId, newId);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Apply a header plan in the caller's transaction: deletes first, renames
   * through a temporary name (so swapping two names never trips the unique
   * index), then new values and new headers. Each value is encrypted with its
   * header's id in the AAD.
   */
  private async writeHeaders(
    tx: Prisma.TransactionClient,
    schoolId: string,
    webhookId: string,
    plan: HeaderPlan,
  ): Promise<void> {
    const now = new Date();
    if (plan.remove.length) {
      await tx.school_webhook_header.deleteMany({ where: { id: { in: plan.remove }, webhook_id: webhookId } });
    }
    const renames = plan.update.filter((u) => u.name !== undefined);
    for (const u of renames) {
      await tx.school_webhook_header.update({ where: { id: u.id }, data: { name: `tmp-${u.id}` } });
    }
    for (const u of plan.update) {
      await tx.school_webhook_header.update({
        where: { id: u.id },
        data: {
          ...(u.name !== undefined ? { name: u.name } : {}),
          ...(u.value !== undefined
            ? { value_enc: encryptWebhookHeaderValue({ schoolId, webhookId, headerId: u.id }, u.value) }
            : {}),
          updated_at: now,
        },
      });
    }
    if (plan.create.length) {
      await tx.school_webhook_header.createMany({
        data: plan.create.map((h) => ({
          id: h.id,
          webhook_id: webhookId,
          name: h.name,
          value_enc: encryptWebhookHeaderValue({ schoolId, webhookId, headerId: h.id }, h.value),
        })),
      });
    }
  }

  /** Email the school's admins that a webhook's TLS verification is off. Never throws. */
  private alertTlsOff(schoolId: string, id: string, name: string) {
    this.logger.warn(`TLS verification turned off for webhook ${id} of school ${schoolId}`);
    void this.alerts.tlsVerificationDisabled(schoolId, { id, name }).catch(() => undefined);
  }

  private async require(schoolId: string, id: string): Promise<WebhookRow> {
    if (!UUID.test(id)) throw new NotFoundException('Webhook not found');
    const row = await this.prisma.school_webhook.findFirst({
      where: { id, school_id: schoolId },
      select: WEBHOOK_SELECT,
    });
    if (!row) throw new NotFoundException('Webhook not found');
    return row;
  }

  private async lastDeliveries(ids: string[]) {
    const out = new Map<string, WebhookItem['lastDelivery']>();
    for (const id of ids) {
      const d = await this.prisma.webhook_delivery.findFirst({
        where: { webhook_id: id },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, event_type: true, created_at: true, last_status_code: true },
      });
      if (d) {
        out.set(id, {
          id: d.id,
          status: d.status as DeliveryStatus,
          eventType: d.event_type,
          createdAt: d.created_at.toISOString(),
          statusCode: d.last_status_code,
        });
      }
    }
    return out;
  }

  private toItem(r: WebhookRow, last: WebhookItem['lastDelivery']): WebhookItem {
    return {
      id: r.id,
      name: r.name,
      url: r.url,
      insecure: r.url.toLowerCase().startsWith('http:'),
      events: eventTypes(r),
      enabled: r.enabled,
      disabledReason: r.disabled_reason,
      consecutiveFailures: r.consecutive_failures,
      hasSecret: true,
      secretUnreadable:
        decryptWebhookSecret({ schoolId: r.school_id, webhookId: r.id }, r.secret_enc) === null,
      headers: r.headers.map((h) => ({
        id: h.id,
        name: h.name,
        hasValue: true as const,
        valueUnreadable:
          decryptWebhookHeaderValue({ schoolId: r.school_id, webhookId: r.id, headerId: h.id }, h.value_enc) === null,
      })),
      tls: { verify: r.verify_tls, caFingerprints: caFingerprints(r.tls_ca_cert) },
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      lastDelivery: last,
    };
  }

  private toDelivery(r: DeliveryRow): DeliveryItem {
    return {
      id: r.id,
      webhookId: r.webhook_id,
      eventId: r.event_id,
      eventType: r.event_type,
      status: r.status as DeliveryStatus,
      attempts: r.attempts,
      maxAttempts: r.event_type === 'ping' ? 1 : maxAttempts(),
      nextAttemptAt: r.status === 'pending' ? iso(r.next_attempt_at) : null,
      lastStatusCode: r.last_status_code,
      lastError: r.last_error,
      durationMs: r.duration_ms,
      tlsVerified: r.tls_verified,
      createdAt: r.created_at.toISOString(),
      deliveredAt: iso(r.delivered_at),
    };
  }
}
