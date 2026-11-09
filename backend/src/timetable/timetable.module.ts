import { Module } from '@nestjs/common';
import { AttendanceModule } from '@/attendance/attendance.module';
import { StudentPortalModule } from '@/student-portal/student-portal.module';
import {
  CourseTimetableController,
  MyTimetableController,
  PortalTimetableController,
  SchoolTimetableController,
} from './timetable.controller';
import { TimetableService } from './timetable.service';
import { TimetableScheduler } from './timetable.scheduler';

/**
 * Timetables and automatic attendance sessions. Opens sessions through
 * AttendanceModule's AttendanceService; course access, features and
 * permissions are global.
 */
@Module({
  imports: [AttendanceModule, StudentPortalModule],
  controllers: [
    SchoolTimetableController,
    CourseTimetableController,
    MyTimetableController,
    PortalTimetableController,
  ],
  providers: [TimetableService, TimetableScheduler],
  exports: [TimetableService],
})
export class TimetableModule {}
