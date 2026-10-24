import { Global, Module } from '@nestjs/common';
import { CourseAccessService } from './course-access.service';

/**
 * Global so grading, announcements, files and the portal can all check
 * course access without importing the course module and its controllers.
 */
@Global()
@Module({
  providers: [CourseAccessService],
  exports: [CourseAccessService],
})
export class CourseAccessModule {}
