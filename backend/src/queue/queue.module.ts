import { Global, Module, Logger, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_FILE_INGEST,
  QUEUE_FILE_SCAN,
  QUEUE_FILE_SHARE_NOTIFY,
} from './queue.constants';
import { FileQueueService } from './file-queue.service';
import { FileIngestHandler } from './handlers/file-ingest.handler';
import { FileScanHandler } from './handlers/file-scan.handler';
import { FileShareNotifyHandler } from './handlers/file-share-notify.handler';
import {
  FileIngestProcessor,
  FileScanProcessor,
  FileShareNotifyProcessor,
} from './processors/file.processors';

const HANDLERS = [FileIngestHandler, FileScanHandler, FileShareNotifyHandler];

@Global()
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    const useRedis =
      process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;

    if (!useRedis) {
      new Logger(QueueModule.name).log(
        'Redis disabled — file queue will process jobs inline',
      );
      return {
        module: QueueModule,
        providers: [FileQueueService, ...HANDLERS],
        exports: [FileQueueService],
      };
    }

    const url = new URL(process.env.REDIS_URL!);
    const connection = {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };

    return {
      module: QueueModule,
      imports: [
        BullModule.forRoot({ connection }),
        BullModule.registerQueue(
          { name: QUEUE_FILE_INGEST },
          { name: QUEUE_FILE_SCAN },
          { name: QUEUE_FILE_SHARE_NOTIFY },
        ),
      ],
      providers: [
        FileQueueService,
        ...HANDLERS,
        FileIngestProcessor,
        FileScanProcessor,
        FileShareNotifyProcessor,
      ],
      exports: [FileQueueService],
    };
  }
}
