import { Global, Logger, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrganisationModule } from '@/organisation/organisation.module';
import { WebhookEvents } from './events/webhook-events.service';
import { WebhookDeliveryService } from './delivery/webhook-delivery.service';
import { WebhookWorker } from './delivery/webhook.worker';
import { WebhookAlertService } from './alerts/webhook-alert.service';
import { IntegrationAuditService } from './audit/integration-audit.service';
import { WebhookService } from './webhooks/webhook.service';
import { WebhookDeliverProcessor } from './delivery/webhook.processor';
import { QUEUE_WEBHOOK_DELIVER } from './config/webhook.constants';
import { SchoolWebhookController, WebhookEventTypesController } from './controllers/school-webhook.controller';
import { OrganisationWebhookController } from './controllers/organisation-webhook.controller';

const PROVIDERS: Provider[] = [
  WebhookEvents,
  WebhookDeliveryService,
  WebhookWorker,
  WebhookAlertService,
  IntegrationAuditService,
  WebhookService,
];

/**
 * Integrations: school webhooks. Global so the services that own each event
 * (grading, attendance, courses, people) can inject WebhookEvents without
 * importing this module. Deliveries are sent from the database by
 * WebhookWorker; with USE_REDIS=true and REDIS_URL (the same switch as
 * QueueModule, whose BullModule.forRoot connection this shares) a BullMQ
 * queue sends them as they fall due as well.
 */
@Global()
@Module({})
export class IntegrationsModule {
  static forRoot(): DynamicModule {
    const useRedis = process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
    if (!useRedis) {
      new Logger(IntegrationsModule.name).log('Redis disabled — webhook deliveries use the database poller');
    }
    return {
      module: IntegrationsModule,
      imports: [
        OrganisationModule,
        ...(useRedis ? [BullModule.registerQueue({ name: QUEUE_WEBHOOK_DELIVER })] : []),
      ],
      controllers: [SchoolWebhookController, OrganisationWebhookController, WebhookEventTypesController],
      providers: [...PROVIDERS, ...(useRedis ? [WebhookDeliverProcessor] : [])],
      exports: [WebhookEvents, WebhookService, IntegrationAuditService, WebhookDeliveryService],
    };
  }
}
