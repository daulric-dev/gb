import { Module } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { AnnouncementController } from './announcement.controller';
import { CourseAnnouncementController } from './course-announcement.controller';

@Module({
  providers: [AnnouncementService],
  controllers: [AnnouncementController, CourseAnnouncementController],
  // The student portal reads course announcements through the service.
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
