import { Injectable } from '@nestjs/common';
import type {
  GradingModel,
  GradingSystemStrategy,
} from '../interfaces/grading-system.interface';
import { WeightedContinuousService } from './weighted-continuous';
import { WeightedCumulativeService } from './weighted-cumulative';
import { ContinuousCumulativeService } from './continuous-cumulative';

@Injectable()
export class GradingSystemFactory {
  private readonly strategies: Map<GradingModel, GradingSystemStrategy>;

  constructor(
    private readonly weightedContinuous: WeightedContinuousService,
    private readonly weightedCumulative: WeightedCumulativeService,
    private readonly continuousCumulative: ContinuousCumulativeService,
  ) {
    this.strategies = new Map<GradingModel, GradingSystemStrategy>([
      ['weighted_continuous', this.weightedContinuous],
      ['weighted_cumulative', this.weightedCumulative],
      ['continuous_cumulative', this.continuousCumulative],
    ]);
  }

  getStrategy(gradingModel: string): GradingSystemStrategy {
    const strategy = this.strategies.get(gradingModel as GradingModel);

    if (!strategy) {
      return this.weightedContinuous;
    }

    return strategy;
  }

  getSupportedModels(): GradingModel[] {
    return [...this.strategies.keys()];
  }
}
