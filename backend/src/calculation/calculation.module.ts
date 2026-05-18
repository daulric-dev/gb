import { Module } from '@nestjs/common';
import { CalculationService } from './calculation.service';
import { CalculationController } from './calculation.controller';
import { GradingSystemFactory } from './grading-systems/grading-system.factory';
import { WeightedContinuousService } from './grading-systems/weighted-continuous';
import { WeightedCumulativeService } from './grading-systems/weighted-cumulative';
import { ContinuousCumulativeService } from './grading-systems/continuous-cumulative';

@Module({
  controllers: [CalculationController],
  providers: [
    CalculationService,
    GradingSystemFactory,
    WeightedContinuousService,
    WeightedCumulativeService,
    ContinuousCumulativeService,
  ],
  exports: [CalculationService],
})
export class CalculationModule {}
