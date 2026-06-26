import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  QUEUE_FILE_INGEST,
  QUEUE_FILE_SCAN,
  QUEUE_FILE_SHARE_NOTIFY,
  type IngestJobData,
  type ScanJobData,
  type ShareNotifyJobData,
} from '../queue.constants';
import { FileIngestHandler } from '../handlers/file-ingest.handler';
import { FileScanHandler } from '../handlers/file-scan.handler';
import { FileShareNotifyHandler } from '../handlers/file-share-notify.handler';

// These processors run only when Redis is enabled (see QueueModule.forRoot).
// Each is a thin adapter: BullMQ delivers the job, the handler does the work.
@Processor(QUEUE_FILE_INGEST)
export class FileIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(FileIngestProcessor.name);
  constructor(private readonly handler: FileIngestHandler) {
    super();
  }
  async process(job: Job<IngestJobData>): Promise<void> {
    await this.handler.run(job.data);
  }
}

@Processor(QUEUE_FILE_SCAN)
export class FileScanProcessor extends WorkerHost {
  private readonly logger = new Logger(FileScanProcessor.name);
  constructor(private readonly handler: FileScanHandler) {
    super();
  }
  async process(job: Job<ScanJobData>): Promise<void> {
    await this.handler.run(job.data);
  }
}

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
