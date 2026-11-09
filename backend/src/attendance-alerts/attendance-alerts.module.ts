import { Module } from '@nestjs/common';
import {
  AttendanceAlertController,
  AttendanceReportController,
  CourseAttendanceReportController,
} from './attendance-alerts.controller';
import { AttendanceReportService } from './attendance-report.service';
import { AttendanceAlertService } from './attendance-alert.service';
import { AttendanceAlertScheduler } from './attendance-alert.scheduler';

/**
 * Attendance reports (percentages, CSV) and threshold alerts. Prisma,
 * cache, features, permissions, mail and course access are global.
 */
@Module({
  controllers: [AttendanceReportController, CourseAttendanceReportController, AttendanceAlertController],
  providers: [AttendanceReportService, AttendanceAlertService, AttendanceAlertScheduler],
})
export class AttendanceAlertsModule {}
