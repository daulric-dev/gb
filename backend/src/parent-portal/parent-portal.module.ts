import { Module } from '@nestjs/common';
import { GradingModule } from '@/grading/grading.module';
import { AnnouncementModule } from '@/announcement/announcement.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ReportCardModule } from '@/report-card/report-card.module';
import { ParentGuard } from './parent.guard';
import { ParentPortalService } from './parent-portal.service';
import { ParentLinkService } from './parent-link.service';
import { ParentNotificationService } from './parent-notification.service';
import { ParentNotificationScheduler } from './parent-notification.scheduler';
import { ParentLinkController, ParentPortalController } from './parent-portal.controller';
import { ParentSettingsController, StudentParentsController } from './parent-staff.controller';
import { ParentReportController } from './parent-report.controller';
import { ParentReportsService } from './parent-reports.service';

/**
 * Parent / guardian portal, behind the `parent_portal` feature (notices
 * behind `parent_notifications`). Reads go through the grading and
 * announcement services the student portal uses; report cards through
 * ReportCardModule's StudentReportsService.
 */
@Module({
  imports: [GradingModule, AnnouncementModule, NotificationsModule, ReportCardModule.forRoot()],
  controllers: [
    ParentPortalController,
    ParentLinkController,
    StudentParentsController,
    ParentSettingsController,
    ParentReportController,
  ],
  providers: [
    ParentGuard,
    ParentPortalService,
    ParentLinkService,
    ParentNotificationService,
    ParentNotificationScheduler,
    ParentReportsService,
  ],
})
export class ParentPortalModule {}
