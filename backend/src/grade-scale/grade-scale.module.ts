import { Module } from '@nestjs/common';
import { GradeScaleService } from './grade-scale.service';
import { GradeScaleController } from './grade-scale.controller';

@Module({
  providers: [GradeScaleService],
  controllers: [GradeScaleController],
  exports: [GradeScaleService],
})
export class GradeScaleModule {}
