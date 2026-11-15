import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessageCipher } from '@/chat/message-cipher.service';
import { QUEUE_DATA_EXPORT } from './data-export.constants';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataExportScheduler } from './data-export.scheduler';
import { DataExportProcessor } from './data-export.processor';

/**
 * Subject access and data portability exports (GDPR Art 15 / 20). With
 * Redis (USE_REDIS=true and REDIS_URL, the same switch as QueueModule, whose
 * BullModule.forRoot connection this shares) exports are built by the
 * `data-export` BullMQ queue; otherwise in-process after the request
 * answers. DataExportScheduler purges expired exports and resumes
 * interrupted ones. MessageCipher (chat) is provided here to decrypt the
 * person's chat messages with the same key ring.
 */
@Module({})
export class DataExportModule {
  static forRoot(): DynamicModule {
    const useRedis = process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
    if (!useRedis) {
      new Logger(DataExportModule.name).log('Redis disabled — data exports are built in-process');
    }
    return {
      module: DataExportModule,
      imports: useRedis ? [BullModule.registerQueue({ name: QUEUE_DATA_EXPORT })] : [],
      controllers: [DataExportController],
      providers: [
        DataExportService,
        DataExportScheduler,
        MessageCipher,
        ...(useRedis ? [DataExportProcessor] : []),
      ],
    };
  }
}
