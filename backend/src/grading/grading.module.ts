import { Module } from '@nestjs/common';
import { GradeScaleModule } from '@/grade-scale/grade-scale.module';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { AssessmentService } from './assessment.service';
import { GradingGroupService } from './grading-group.service';
import { ActivityService } from './activity.service';
import { SubmissionService } from './submission.service';
import { GradeService } from './grade.service';
import { AssessmentController } from './assessment.controller';
import { GradingGroupController } from './grading-group.controller';
import { ActivityController } from './activity.controller';
import { GradeController } from './grade.controller';

@Module({
  imports: [GradeScaleModule, FileManagerModule],
  providers: [
    AssessmentService,
    GradeService,
    GradingGroupService,
    ActivityService,
    SubmissionService,
  ],
  // The student portal submits and reads its own work through these.
  exports: [SubmissionService],
  controllers: [
    AssessmentController,
    GradeController,
    GradingGroupController,
    ActivityController,
  ],
})
export class GradingModule {}
