import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';
import { NotificationSettingsService } from './notification-settings.service';
import {
  NotificationPreferencesController,
  OrganisationPushContentController,
  SchoolPushContentController,
} from './notification-settings.controller';

/**
 * Device registration and Expo push; features send through PushService.
 * Also each account's notification preferences and the push-content
 * setting (full or generic lock-screen text).
 */
@Module({
  controllers: [
    NotificationsController,
    NotificationPreferencesController,
    SchoolPushContentController,
    OrganisationPushContentController,
  ],
  providers: [PushService, NotificationSettingsService],
  exports: [PushService, NotificationSettingsService],
})
export class NotificationsModule {}
