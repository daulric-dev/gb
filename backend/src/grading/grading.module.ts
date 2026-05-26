import { Module } from '@nestjs/common';
import { AssessmentService } from './assessment.service';
import { GradeService } from './grade.service';
import { AssessmentController } from './assessment.controller';
import { GradeController } from './grade.controller';

@Module({
  providers: [AssessmentService, GradeService],
  controllers: [AssessmentController, GradeController],
})
export class GradingModule {}
