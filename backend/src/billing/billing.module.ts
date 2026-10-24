import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '@/auth/auth.module';
import { PermissionModule } from '@/permission/permission.module';
import { BillingRegistry } from './billing.registry';
import { SubscriptionService } from './subscription.service';
import { SeatService } from './seat.service';
import { InvoiceService } from './invoice.service';
import { BillingEventsService } from './billing-events.service';
import { BillingService } from './billing.service';
import { PlatformService } from './platform.service';
import { BillingScheduler } from './billing.scheduler';
import { BillingEnabledGuard, PlatformAdminGuard } from './billing.guards';
import { BillingEntitlementInterceptor } from './billing.interceptor';
import { BillingController, BillingStatusController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { PlatformController, PlatformMeController } from './platform.controller';

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
