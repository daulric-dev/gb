import { Module } from '@nestjs/common';
import { StudentGuard } from '@/student-portal/student.guard';
import { CalendarService } from './calendar.service';
import {
  CalendarController,
  PortalCalendarController,
} from './calendar.controller';

/**
 * Activity due dates as a calendar, for staff and for students. Reads only;
 * the portal route's StudentGuard is provided here directly.
 */
@Module({
  controllers: [CalendarController, PortalCalendarController],
  providers: [CalendarService, StudentGuard],
})
export class CalendarModule {}
