import { Module } from '@nestjs/common';
import { GradeScaleModule } from '@/grade-scale/grade-scale.module';
import { AssessmentService } from './assessment.service';
import { GradingGroupService } from './grading-group.service';
import { GradeService } from './grade.service';
import { AssessmentController } from './assessment.controller';
import { GradingGroupController } from './grading-group.controller';
import { GradeController } from './grade.controller';

@Module({
  imports: [GradeScaleModule],
  providers: [AssessmentService, GradeService, GradingGroupService],
  controllers: [
    AssessmentController,
    GradeController,
    GradingGroupController,
  ],
})
export class GradingModule {}
