import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '@/auth/auth.module';
import { PermissionModule } from '@/permission/permission.module';
import { BillingRegistry } from './providers/billing.registry';
import { SubscriptionService } from './subscriptions/subscription.service';
import { SeatService } from './subscriptions/seat.service';
import { InvoiceService } from './subscriptions/invoice.service';
import { BillingEventsService } from './webhooks/billing-events.service';
import { BillingService } from './school/billing.service';
import { PlatformService } from './platform/platform.service';
import { BillingScheduler } from './jobs/billing.scheduler';
import { BillingEnabledGuard, PlatformAdminGuard } from './access/billing.guards';
import { BillingEntitlementInterceptor } from './access/billing.interceptor';
import { BillingController, BillingStatusController } from './school/billing.controller';
import { BillingWebhookController } from './webhooks/billing-webhook.controller';
import { PlatformController, PlatformMeController } from './platform/platform.controller';

/**
 * SaaS billing for the hosted platform. Inert unless BILLING_ENABLED=true:
 * routes 404 (bar /billing/status), the scheduler never starts and the
 * entitlement interceptor returns straight away.
 */
@Module({
  imports: [AuthModule, PermissionModule],
  controllers: [
    BillingStatusController,
    BillingController,
    BillingWebhookController,
    PlatformMeController,
    PlatformController,
  ],
  providers: [
    BillingRegistry,
    SubscriptionService,
    SeatService,
    InvoiceService,
    BillingEventsService,
    BillingService,
    PlatformService,
    BillingScheduler,
    BillingEnabledGuard,
    PlatformAdminGuard,
    { provide: APP_INTERCEPTOR, useClass: BillingEntitlementInterceptor },
  ],
  exports: [BillingRegistry, SubscriptionService],
})
export class BillingModule {}
