import { eventMessage } from '@/integrations/events/webhook-event-types';

/**
 * The body of every webhook POST, exactly these three keys:
 *
 *   { "event_type": "grade.recorded", "message": "...", "data": { "school": {...}, ... } }
 *
 * Everything else about the event travels in headers (see webhookHeaders):
 * X-GradeBook-Event-Id (dedupe on it), X-GradeBook-School-Id,
 * X-GradeBook-Api-Version, X-GradeBook-Timestamp, X-GradeBook-Delivery.
 * webhook_delivery.payload stores this envelope, so what an admin sees is
 * what was sent.
 */
export interface WebhookEnvelope {
  event_type: string;
  message: string;
  data: Record<string, unknown>;
}

/**
 * The body as it was before the three-key envelope (deliveries stored then
 * still have it): converted by `toEnvelope` when such a delivery is retried
 * or redelivered.
 */
export interface LegacyWebhookEnvelope {
  id: string;
  type: string;
  apiVersion: number;
  createdAt: string;
  school: { id: string; name: string };
  data: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** An event's envelope; `data` must already carry `school`. */
export function buildEnvelope(eventType: string, data: Record<string, unknown>): WebhookEnvelope {
  return { event_type: eventType, message: eventMessage(eventType, data), data };
}

/** A stored payload in the old `{ id, type, apiVersion, createdAt, school, data }` shape. */
export function isLegacyEnvelope(payload: unknown): payload is LegacyWebhookEnvelope {
  return isRecord(payload) && !('event_type' in payload) && typeof payload.type === 'string';
}

/**
 * A stored payload as the envelope to send. An old-shape one is converted:
 * its `school` moves into `data` (first), the message is built from the
 * data, and its id / apiVersion / createdAt are dropped (the id and version
 * are in headers; the delivery row keeps its creation time). `converted`
 * tells the caller to store the result, so the row shows what was sent.
 */
export function toEnvelope(
  payload: unknown,
  eventType: string,
): { envelope: WebhookEnvelope; converted: boolean } {
  if (isLegacyEnvelope(payload)) {
    const own = isRecord(payload.data) ? payload.data : {};
    const data = isRecord(payload.school) && !('school' in own) ? { school: payload.school, ...own } : own;
    return { envelope: buildEnvelope(payload.type || eventType, data), converted: true };
  }
  const p = isRecord(payload) ? payload : {};
  const type = typeof p.event_type === 'string' && p.event_type ? p.event_type : eventType;
  const data = isRecord(p.data) ? p.data : {};
  const message = typeof p.message === 'string' && p.message ? p.message : eventMessage(type, data);
  return { envelope: { event_type: type, message, data }, converted: false };
}

/**
 * The body sent: the envelope's three keys in a fixed order (jsonb does not
 * keep key order), so every delivery of an event reads the same way.
 */
export function envelopeBody(envelope: WebhookEnvelope): string {
  return JSON.stringify({ event_type: envelope.event_type, message: envelope.message, data: envelope.data });
}
