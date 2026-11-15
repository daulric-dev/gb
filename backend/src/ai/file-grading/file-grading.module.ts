import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiModule } from '../ai.module';
import { AiFileGradingController } from './file-grading.controller';
import { AiFileGradingService } from './file-grading.service';
import { AiFileGradingQueueService } from './file-grading-queue.service';
import { AiFileGradingProcessor } from './file-grading.processor';
import { QUEUE_AI_FILE_GRADING } from './file-grading.constants';

/**
 * AI grading drafts for handed-in files (feature `ai_assistance`). With
 * Redis (USE_REDIS=true and REDIS_URL, sharing QueueModule's BullMQ
 * connection) batch drafts run on the `ai-file-grading` queue; otherwise
 * in-process. AiService comes from AiModule; StorageService,
 * CourseAccessService, FeatureService and AuditLogService are global.
 */
@Module({})
export class AiFileGradingModule {
  private static instance?: DynamicModule;

  static forRoot(): DynamicModule {
    AiFileGradingModule.instance ??= AiFileGradingModule.build();
    return AiFileGradingModule.instance;
  }

  private static build(): DynamicModule {
    const useRedis = process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
    if (!useRedis) new Logger(AiFileGradingModule.name).log('Redis disabled — AI grading drafts run in-process');
    return {
      module: AiFileGradingModule,
      imports: [AiModule, ...(useRedis ? [BullModule.registerQueue({ name: QUEUE_AI_FILE_GRADING })] : [])],
      controllers: [AiFileGradingController],
      providers: [AiFileGradingService, AiFileGradingQueueService, ...(useRedis ? [AiFileGradingProcessor] : [])],
    };
  }
}
