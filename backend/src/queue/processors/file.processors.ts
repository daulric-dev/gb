import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  QUEUE_FILE_SHARE_NOTIFY,
  type ShareNotifyJobData,
} from '../queue.constants';
import { FileShareNotifyHandler } from '../handlers/file-share-notify.handler';

// This processor runs only when Redis is enabled (see QueueModule.forRoot).
// A thin adapter: BullMQ delivers the job, the handler does the work.
@Processor(QUEUE_FILE_SHARE_NOTIFY)
export class FileShareNotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(FileShareNotifyProcessor.name);
  constructor(private readonly handler: FileShareNotifyHandler) {
    super();
  }
  async process(job: Job<ShareNotifyJobData>): Promise<void> {
    await this.handler.run(job.data);
  }
}
