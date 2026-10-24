import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/notifications/notifications.module';
import { StudentPortalModule } from '@/student-portal/student-portal.module';
import { AttendanceController } from './attendance.controller';
import { PortalAttendanceController } from './portal-attendance.controller';
import { ScanClaimController } from './scan-claim.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRealtime } from './attendance.realtime';

/**
 * Course attendance with student self check-in. Course access and the
 * realtime bus are global; pushes go through NotificationsModule, and the
 * portal routes reuse StudentGuard from the student portal.
 */
@Module({
  imports: [NotificationsModule, StudentPortalModule],
  controllers: [
    AttendanceController,
    PortalAttendanceController,
    ScanClaimController,
  ],
  providers: [AttendanceService, AttendanceRealtime],
})
export class AttendanceModule {}
