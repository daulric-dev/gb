import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WebhookDeliveryService } from '@/integrations/delivery/webhook-delivery.service';
import { CLAIM_BATCH, pollIntervalMs } from '@/integrations/config/webhook.config';

/** With Redis the queue does the prompt work; the poller is only a backstop. */
const QUEUE_BACKSTOP_MS = 60_000;

/**
 * Sends due webhook deliveries from the database, in every API instance.
 * Claims are atomic (FOR UPDATE SKIP LOCKED plus a lease), so instances never
 * send the same delivery twice at once and a crashed one's work comes back.
 *
 * Without Redis this is the delivery mechanism: every WEBHOOK_POLL_INTERVAL_MS
 * (default 5 s), and straight after an event is queued (`kick`). With Redis
 * (USE_REDIS=true) BullMQ jobs send deliveries as they fall due and this runs
 * once a minute to catch anything a job missed.
 */
@Injectable()
export class WebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private again = false;
  private stopped = false;

  constructor(private readonly deliveries: WebhookDeliveryService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const every = this.deliveries.usesQueue ? QUEUE_BACKSTOP_MS : pollIntervalMs();
    this.timer = setInterval(() => void this.tick(), every);
    this.logger.log(
      `Webhook deliveries: ${this.deliveries.usesQueue ? 'BullMQ queue, database backstop every 60 s' : `database poll every ${every} ms`}`,
    );
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** New deliveries are waiting: look now rather than at the next tick. */
  kick() {
    if (this.stopped || process.env.NODE_ENV === 'test') return;
    setImmediate(() => void this.tick());
  }

  /** Claim and send until nothing is due (or a round comes back short). */
  async tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        let n: number;
        do {
          n = await this.deliveries.processDue(CLAIM_BATCH);
        } while (n === CLAIM_BATCH && !this.stopped);
      } while (this.again && !this.stopped);
    } catch (err) {
      this.logger.error(`Webhook delivery round failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
