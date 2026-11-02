import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_WEBHOOK_DELIVER, type WebhookDeliverJob } from '@/integrations/config/webhook.constants';
import { WebhookDeliveryService } from '@/integrations/delivery/webhook-delivery.service';

// Registered only when Redis is enabled (see IntegrationsModule.forRoot). A
// thin adapter: the job names a delivery; the service claims it (a no-op when
// it is not due or another worker has it) and sends it. Retries are
// scheduled by the service as new delayed jobs, not by BullMQ's own retry.
@Processor(QUEUE_WEBHOOK_DELIVER, { concurrency: 10 })
export class WebhookDeliverProcessor extends WorkerHost {
  constructor(private readonly deliveries: WebhookDeliveryService) {
    super();
  }

  async process(job: Job<WebhookDeliverJob>): Promise<void> {
    await this.deliveries.processOne(job.data.deliveryId);
  }
}
