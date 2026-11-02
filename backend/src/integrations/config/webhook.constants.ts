/** BullMQ queue for webhook deliveries (Redis mode only; see WebhookWorker). */
export const QUEUE_WEBHOOK_DELIVER = 'webhook-deliver';

/** One delivery to send: the row in public.webhook_delivery. */
export interface WebhookDeliverJob {
  deliveryId: string;
}
