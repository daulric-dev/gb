import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '@/notifications/notifications.module';
import { StudentGuard } from '@/student-portal/student.guard';
import { CourseNotificationService } from './course-notification.service';
import { CourseNotificationController } from './course-notification.controller';

/**
 * Notices to students about new work and announcements, in-app and by push.
 *
 * Global so grading and announcements can tell students about what they
 * publish without importing this module (and without a cycle through the
 * student portal, whose guard is provided here directly).
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [CourseNotificationController],
  providers: [CourseNotificationService, StudentGuard],
  exports: [CourseNotificationService],
})
export class CourseNotificationModule {}
