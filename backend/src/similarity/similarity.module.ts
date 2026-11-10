import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_SIMILARITY_CHECK } from './similarity.constants';
import { SimilarityService } from './similarity.service';
import { SimilarityQueueService } from './similarity-queue.service';
import { SimilarityProcessor } from './similarity.processor';
import {
  SchoolSimilarityController,
  SimilarityController,
} from './similarity.controller';

/**
 * Similarity check on text submissions (feature `similarity_check`). With
 * Redis (USE_REDIS=true and REDIS_URL, the same switch as QueueModule, whose
 * BullModule.forRoot connection this shares) checks run on the
 * `similarity-check` queue; otherwise in-process after the hand-in.
 */
@Module({})
export class SimilarityModule {
  private static instance?: DynamicModule;

  static forRoot(): DynamicModule {
    SimilarityModule.instance ??= SimilarityModule.build();
    return SimilarityModule.instance;
  }

  private static build(): DynamicModule {
    const useRedis = process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
    if (!useRedis) {
      new Logger(SimilarityModule.name).log('Redis disabled — similarity checks run in-process');
    }
    return {
      module: SimilarityModule,
      imports: useRedis ? [BullModule.registerQueue({ name: QUEUE_SIMILARITY_CHECK })] : [],
      controllers: [SimilarityController, SchoolSimilarityController],
      providers: [
        SimilarityService,
        SimilarityQueueService,
        ...(useRedis ? [SimilarityProcessor] : []),
      ],
      exports: [SimilarityService],
    };
  }
}
