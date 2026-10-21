import { Module } from '@nestjs/common';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { ActivityService } from './activity.service';
import { SubmissionService } from './submission.service';
import { AssignmentGroupService } from './assignment-group.service';
import { GradebookService } from './gradebook.service';
import { ActivityController } from './activity.controller';
import { AssignmentGroupController } from './assignment-group.controller';
import { GradebookController } from './gradebook.controller';

/**
 * Course work and marks: activities, submissions, assignment groups and the
 * gradebook. Course access comes from the global CourseAccessModule.
 */
@Module({
  imports: [FileManagerModule],
  providers: [
    ActivityService,
    SubmissionService,
    AssignmentGroupService,
    GradebookService,
  ],
  // The student portal submits work, lists course activities and reads
  // grades through these.
  exports: [SubmissionService, GradebookService],
  controllers: [
    ActivityController,
    AssignmentGroupController,
    GradebookController,
  ],
})
export class GradingModule {}
