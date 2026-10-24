import { Module } from '@nestjs/common';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { ActivityService } from './activity.service';
import { SubmissionService } from './submission.service';
import { AssignmentGroupService } from './assignment-group.service';
import { GradebookService } from './gradebook.service';
import { ActivityController } from './activity.controller';
import { AssignmentGroupController } from './assignment-group.controller';
import { GradebookController } from './gradebook.controller';
import { RubricService } from './rubric.service';
import { GradebookImportService } from './gradebook-import.service';
import { RubricController } from './rubric.controller';

/**
 * Course work and marks: activities, submissions, assignment groups, rubrics
 * and the gradebook. Course access comes from the global CourseAccessModule.
 */
@Module({
  imports: [FileManagerModule],
  providers: [
    ActivityService,
    SubmissionService,
    AssignmentGroupService,
    GradebookService,
    RubricService,
    GradebookImportService,
  ],
  // The student portal submits work, lists course activities and reads
  // grades through these.
  exports: [SubmissionService, GradebookService],
  controllers: [
    ActivityController,
    AssignmentGroupController,
    GradebookController,
    RubricController,
  ],
})
export class GradingModule {}
