import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import type { Prisma } from '@/generated/prisma/client';
import { decryptWebhookSecret } from '@/integrations/webhooks/webhook-secret';
import { sendWebhook, type FetchLike, type WebhookAttempt } from '@/integrations/delivery/webhook-sender';
import {
  backoffMs,
  CLAIM_BATCH,
  CLAIM_LEASE_MS,
  maxAttempts,
  maxConsecutiveFailures,
} from '@/integrations/config/webhook.config';
import { IntegrationAuditService, SYSTEM_ACTOR } from '@/integrations/audit/integration-audit.service';
import { WebhookAlertService } from '@/integrations/alerts/webhook-alert.service';
import { QUEUE_WEBHOOK_DELIVER, type WebhookDeliverJob } from '@/integrations/config/webhook.constants';

export type DeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'abandoned';

/** The envelope as stored in webhook_delivery.payload. */
export interface WebhookEnvelope {
  id: string;
  type: string;
  apiVersion: number;
  createdAt: string;
  school: { id: string; name: string };
  data: Record<string, unknown>;
}

/**
 * The body sent: the envelope's fields in a fixed order (jsonb does not keep
 * key order), so every delivery of an event reads the same way.
 */
export function envelopeBody(payload: unknown): string {
  const p = (payload ?? {}) as Partial<WebhookEnvelope>;
  return JSON.stringify({
    id: p.id,
    type: p.type,
    apiVersion: p.apiVersion,
    createdAt: p.createdAt,
    school: p.school,
    data: p.data,
  });
}

const DELIVERY_SELECT = {
  id: true,
  webhook_id: true,
  school_id: true,
  event_type: true,
  payload: true,
  status: true,
  attempts: true,
} satisfies Prisma.webhook_deliverySelect;

const WEBHOOK_SELECT = {
  id: true,
  school_id: true,
  name: true,
  url: true,
  secret_enc: true,
  enabled: true,
} satisfies Prisma.school_webhookSelect;

/**
 * Sends webhook deliveries and keeps their retry state. The database is the
 * queue: a delivery row is `pending` with a `next_attempt_at`, and whoever
 * claims it (an atomic UPDATE ... FOR UPDATE SKIP LOCKED that pushes
 * `next_attempt_at` out by a lease) sends it. The poller (WebhookWorker) and,
 * with Redis, a BullMQ job per delivery both end up in `processDue` /
 * `processOne`; a delivery is only ever sent by the one that claimed it.
 *
 * A failed attempt is retried with backoff (see webhook.config.ts) until
 * WEBHOOK_MAX_ATTEMPTS, then `abandoned`. Every failed attempt counts
 * towards the webhook's `consecutive_failures` (a success resets it); at
 * WEBHOOK_MAX_CONSECUTIVE_FAILURES the webhook switches itself off and the
 * school's admins are emailed. Tests and redeliveries are sent at once, are
 * not retried and do not count.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  /** Injectable for tests. */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);
  random: () => number = Math.random;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly audit: IntegrationAuditService,
    private readonly alerts: WebhookAlertService,
    @Optional()
    @InjectQueue(QUEUE_WEBHOOK_DELIVER)
    private readonly queue?: Queue<WebhookDeliverJob>,
  ) {}

  /** Redis mode: hand new or rescheduled deliveries to BullMQ. */
  get usesQueue(): boolean {
    return !!this.queue;
  }

  /** Tell the queue about deliveries due after `delayMs`. Never throws. */
  async schedule(ids: string[], delayMs = 0): Promise<void> {
    if (!this.queue || ids.length === 0) return;
    try {
      await this.queue.addBulk(
        ids.map((deliveryId) => ({
          name: 'deliver',
          data: { deliveryId },
          opts: { delay: Math.max(0, delayMs), removeOnComplete: 1000, removeOnFail: 5000 },
        })),
      );
    } catch (err) {
      // The poller picks them up anyway.
      this.logger.warn(`Failed to queue webhook deliveries: ${(err as Error).message}`);
    }
  }

  /**
   * Claim up to `limit` due deliveries (or just `onlyId`, when it is due):
   * pushes their `next_attempt_at` out by the lease, so another worker skips
   * them and a crashed worker's are retried once it lapses.
   */
  async claim(limit = CLAIM_BATCH, onlyId?: string): Promise<string[]> {
    const lease = new Date(Date.now() + CLAIM_LEASE_MS);
    const rows = onlyId
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          UPDATE public.webhook_delivery SET next_attempt_at = ${lease}
          WHERE id IN (
            SELECT id FROM public.webhook_delivery
            WHERE id = ${onlyId}::uuid AND status = 'pending' AND next_attempt_at <= now()
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`
      : await this.prisma.$queryRaw<{ id: string }[]>`
          UPDATE public.webhook_delivery SET next_attempt_at = ${lease}
          WHERE id IN (
            SELECT id FROM public.webhook_delivery
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY next_attempt_at
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`;
    return rows.map((r) => r.id);
  }

  /** One round of the poller: claim what is due and send it. Returns how many. */
  async processDue(limit = CLAIM_BATCH): Promise<number> {
    const ids = await this.claim(limit);
    await Promise.all(ids.map((id) => this.attempt(id).catch((err: Error) =>
      this.logger.error(`Webhook delivery ${id} failed unexpectedly: ${err.message}`),
    )));
    return ids.length;
  }

  /** A BullMQ job: send this delivery if it is still due and nobody has it. */
  async processOne(deliveryId: string): Promise<void> {
    const [id] = await this.claim(1, deliveryId);
    if (id) await this.attempt(id);
  }

  /**
   * Send a claimed delivery once and record the outcome: success, a retry
   * with backoff, or abandoned after the last attempt.
   */
  async attempt(deliveryId: string): Promise<WebhookAttempt | null> {
    const delivery = await this.prisma.webhook_delivery.findUnique({
      where: { id: deliveryId },
      select: { ...DELIVERY_SELECT, webhook: { select: WEBHOOK_SELECT } },
    });
    if (!delivery || delivery.status !== 'pending') return null;
    const hook = delivery.webhook;

    // Switched off since the event was queued: nothing is sent.
    const stop = !hook.enabled
      ? 'Not sent: the webhook is switched off'
      : !(await this.features.isEnabled(delivery.school_id, 'integrations'))
        ? 'Not sent: integrations are switched off for this school'
        : null;
    if (stop) {
      await this.prisma.webhook_delivery.update({
        where: { id: deliveryId },
        data: { status: 'abandoned', next_attempt_at: null, last_error: stop },
      });
      return null;
    }

    const result = await this.send(hook, delivery);
    const attempts = delivery.attempts + 1;
    const now = new Date();

    if (result.ok) {
      await this.prisma.$transaction([
        this.prisma.webhook_delivery.update({
          where: { id: deliveryId },
          data: {
            ...outcome(result),
            attempts,
            status: 'succeeded',
            next_attempt_at: null,
            delivered_at: now,
          },
        }),
        this.prisma.school_webhook.updateMany({
          where: { id: hook.id, consecutive_failures: { gt: 0 } },
          data: { consecutive_failures: 0 },
        }),
      ]);
      return result;
    }

    const last = attempts >= maxAttempts();
    const delay = last ? 0 : backoffMs(attempts, this.random);
    await this.prisma.webhook_delivery.update({
      where: { id: deliveryId },
      data: {
        ...outcome(result),
        attempts,
        status: last ? 'abandoned' : 'pending',
        next_attempt_at: last ? null : new Date(now.getTime() + delay),
      },
    });
    if (!last) await this.schedule([deliveryId], delay);
    await this.countFailure(hook);
    return result;
  }

  /**
   * Send a delivery right now, outside the retry schedule (Test and
   * Redeliver): the row ends `succeeded` or `failed`, and the webhook's
   * failure count is left alone.
   */
  async sendNow(deliveryId: string): Promise<WebhookAttempt | null> {
    const delivery = await this.prisma.webhook_delivery.findUnique({
      where: { id: deliveryId },
      select: { ...DELIVERY_SELECT, webhook: { select: WEBHOOK_SELECT } },
    });
    if (!delivery) return null;
    const result = await this.send(delivery.webhook, delivery);
    await this.prisma.webhook_delivery.update({
      where: { id: deliveryId },
      data: {
        ...outcome(result),
        attempts: delivery.attempts + 1,
        status: result.ok ? 'succeeded' : 'failed',
        next_attempt_at: null,
        delivered_at: result.ok ? new Date() : null,
      },
    });
    return result;
  }

  private async send(
    hook: { id: string; school_id: string; url: string; secret_enc: string },
    delivery: { id: string; event_type: string; payload: unknown },
  ): Promise<WebhookAttempt> {
    const secret = decryptWebhookSecret(
      { schoolId: hook.school_id, webhookId: hook.id },
      hook.secret_enc,
    );
    if (!secret) {
      return {
        ok: false,
        statusCode: null,
        error: "The signing secret can't be read (AUTH_SECRET changed?): rotate the webhook's secret",
        responseExcerpt: null,
        durationMs: 0,
      };
    }
    return sendWebhook(
      {
        url: hook.url,
        secret,
        deliveryId: delivery.id,
        eventType: delivery.event_type,
        body: envelopeBody(delivery.payload),
      },
      this.fetchImpl,
    );
  }

  /**
   * One more failure in a row; at the limit the webhook switches itself off
   * (once: only the update that flips `enabled` audits and alerts).
   */
  private async countFailure(hook: { id: string; school_id: string; name: string }) {
    try {
      const updated = await this.prisma.school_webhook.update({
        where: { id: hook.id },
        data: { consecutive_failures: { increment: 1 } },
        select: { consecutive_failures: true, enabled: true },
      });
      const limit = maxConsecutiveFailures();
      if (!updated.enabled || updated.consecutive_failures < limit) return;

      const reason = `Switched off automatically after ${updated.consecutive_failures} failed deliveries in a row`;
      const flipped = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.school_webhook.updateMany({
          where: { id: hook.id, enabled: true },
          data: { enabled: false, disabled_reason: reason, updated_at: new Date() },
        });
        if (count === 0) return false;
        await this.audit.record(tx, hook.school_id, SYSTEM_ACTOR, [
          {
            action: 'webhook_auto_disabled',
            webhookId: hook.id,
            webhook: hook.name,
            changes: {
              enabled: { before: true, after: false },
              consecutiveFailures: updated.consecutive_failures,
            },
          },
        ]);
        return true;
      });
      if (flipped) {
        this.logger.warn(`Webhook ${hook.id} of school ${hook.school_id} switched off: ${reason}`);
        void this.alerts
          .autoDisabled(hook.school_id, { id: hook.id, name: hook.name }, updated.consecutive_failures)
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.error(`Failed to count a failure for webhook ${hook.id}: ${(err as Error).message}`);
    }
  }
}

function outcome(r: WebhookAttempt) {
  return {
    last_status_code: r.statusCode,
    last_error: r.error,
    response_excerpt: r.responseExcerpt,
    duration_ms: r.durationMs,
  };
}
