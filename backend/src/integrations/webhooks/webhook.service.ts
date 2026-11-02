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
  WEBHOOK_API_VERSION,
} from '@/integrations/events/webhook-event-types';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
} from '@/integrations/webhooks/webhook-secret';
import {
  IntegrationAuditService,
  type IntegrationActor,
  type IntegrationAuditEntry,
} from '@/integrations/audit/integration-audit.service';
import {
  WebhookDeliveryService,
  type DeliveryStatus,
  type WebhookEnvelope,
} from '@/integrations/delivery/webhook-delivery.service';
import { maxAttempts } from '@/integrations/config/webhook.config';
import {
  DELIVERIES_DEFAULT_LIMIT,
  DELIVERIES_MAX_LIMIT,
  MAX_NAME,
  MAX_URL,
} from '@/integrations/webhooks/dto/webhook.dto';

/** A webhook as admins see it. Never the secret. */
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

/** Create and rotate answer with the secret, the only time it is shown. */
export interface WebhookWithSecret {
  webhook: WebhookItem;
  secret: string;
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
}

export type WebhookPatch = Partial<WebhookInput>;

const WEBHOOK_SELECT = {
  id: true,
  school_id: true,
  name: true,
  url: true,
  secret_enc: true,
  events: true,
  enabled: true,
  consecutive_failures: true,
  disabled_reason: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.school_webhookSelect;

type WebhookRow = Prisma.school_webhookGetPayload<{ select: typeof WEBHOOK_SELECT }>;

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
  created_at: true,
  delivered_at: true,
} satisfies Prisma.webhook_deliverySelect;

type DeliveryRow = Prisma.webhook_deliveryGetPayload<{ select: typeof DELIVERY_SELECT }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A webhook URL: syntax only. Any http(s) URL is accepted, private and
 * internal addresses included - self-hosted schools call systems on their own
 * network - so there is no address filtering. Returns the normalised URL.
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
    const id = randomUUID();
    const secret = generateWebhookSecret();
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
            events,
            enabled,
            created_by: actor.id,
          },
          select: WEBHOOK_SELECT,
        });
        await this.audit.record(tx, schoolId, actor, [
          {
            action: 'webhook_created',
            webhookId: id,
            webhook: name,
            changes: { name, url, events, enabled },
          },
        ]);
        return created;
      });
    } catch (err) {
      this.logger.error(`Failed to create a webhook for school ${schoolId}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create the webhook');
    }
    this.logger.log(`User ${actor.id} created webhook ${id} for school ${schoolId}`);
    return { webhook: this.toItem(row, null), secret };
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
      patch.enabled === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }
    const before = await this.require(schoolId, id);
    const data: Prisma.school_webhookUpdateInput = {};
    const changes: Record<string, { before: unknown; after: unknown }> = {};

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
      if (JSON.stringify(events) !== JSON.stringify(before.events)) {
        data.events = events;
        changes.events = { before: before.events, after: events };
      }
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
        await this.audit.record(tx, schoolId, actor, entries);
      });
    } catch (err) {
      this.logger.error(`Failed to update webhook ${id}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update the webhook');
    }
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
            changes: { url: before.url, events: before.events },
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
  ): Promise<WebhookWithSecret> {
    const before = await this.require(schoolId, id);
    const secret = generateWebhookSecret();
    const secretEnc = encryptWebhookSecret({ schoolId, webhookId: id }, secret);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.school_webhook.update({
          where: { id },
          data: { secret_enc: secretEnc, updated_at: new Date() },
        });
        await this.audit.record(tx, schoolId, actor, [
          { action: 'secret_rotated', webhookId: id, webhook: before.name, changes: {} },
        ]);
      });
    } catch (err) {
      this.logger.error(`Failed to rotate webhook ${id}'s secret: ${(err as Error).message}`);
      throw new BadRequestException('Failed to rotate the secret');
    }
    return { webhook: await this.get(schoolId, id), secret };
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
    const envelope: WebhookEnvelope = {
      id: randomUUID(),
      type: 'ping',
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      school: { id: schoolId, name: school?.name ?? '' },
      data: { message: 'Test delivery from GradeBook', webhook: { id, name: hook.name } },
    };
    const deliveryId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhook_delivery.create({
        data: {
          webhook_id: id,
          school_id: schoolId,
          event_id: envelope.id,
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
   * retried; works while the webhook is switched off, to check a fix.
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
          payload: original.payload as Prisma.InputJsonValue,
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
      events: r.events,
      enabled: r.enabled,
      disabledReason: r.disabled_reason,
      consecutiveFailures: r.consecutive_failures,
      hasSecret: true,
      secretUnreadable:
        decryptWebhookSecret({ schoolId: r.school_id, webhookId: r.id }, r.secret_enc) === null,
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
      createdAt: r.created_at.toISOString(),
      deliveredAt: iso(r.delivered_at),
    };
  }
}
