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
import { ExtensionService } from './extension.service';
import { ExtensionController } from './extension.controller';
import { AccommodationService } from './accommodation.service';
import { QuestionBankService } from './question-bank.service';
import { QuestionBankController } from './question-bank.controller';
import {
  ActivityAccommodationController,
  StudentAccommodationController,
} from './accommodation.controller';

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
    ExtensionService,
    AccommodationService,
    QuestionBankService,
  ],
  // The student portal submits work, lists course activities and reads
  // grades through these.
  // LTI creates gradebook columns for external tools through ActivityService.
  // The AI course builder (src/ai) creates activities and matches assignment
  // groups through these.
  exports: [SubmissionService, GradebookService, ActivityService, AssignmentGroupService],
  controllers: [
    ActivityController,
    AssignmentGroupController,
    GradebookController,
    RubricController,
    ExtensionController,
    ActivityAccommodationController,
    StudentAccommodationController,
    QuestionBankController,
  ],
})
export class GradingModule {}
