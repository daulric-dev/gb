/**
 * The public face of webhook events for the services that own them: inject
 * WebhookEvents (global) and call `emit` / `emitForCourse` after a change
 * commits. Everything else in src/integrations is internal.
 */
export {
  WebhookEvents,
  toActivityRef,
  scoreValue,
  type PersonRef,
  type CourseRef,
  type ActivityRef,
} from './webhook-events.service';
export {
  WEBHOOK_EVENT_KEYS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_API_VERSION,
  isWebhookEventKey,
  validateEventData,
} from './webhook-event-types';
