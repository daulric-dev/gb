import { Module } from '@nestjs/common';
import { GradeScaleModule } from '@/grade-scale/grade-scale.module';
import { AssessmentService } from './assessment.service';
import { GradeService } from './grade.service';
import { AssessmentController } from './assessment.controller';
import { GradeController } from './grade.controller';

@Module({
  imports: [GradeScaleModule],
  providers: [AssessmentService, GradeService],
  controllers: [AssessmentController, GradeController],
})
export class GradingModule {}
