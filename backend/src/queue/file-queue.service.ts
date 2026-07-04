import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  QUEUE_FILE_INGEST,
  QUEUE_FILE_SCAN,
  QUEUE_FILE_SHARE_NOTIFY,
  type IngestJobData,
  type ScanJobData,
  type ShareNotifyJobData,
} from './queue.constants';
import { FileIngestHandler } from './handlers/file-ingest.handler';
import { FileScanHandler } from './handlers/file-scan.handler';
import { FileShareNotifyHandler } from './handlers/file-share-notify.handler';

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

// For Queuing Files
@Injectable()
export class FileQueueService {
  private readonly logger = new Logger(FileQueueService.name);
  private readonly async: boolean;

  constructor(
    @Optional()
    @InjectQueue(QUEUE_FILE_INGEST)
    private readonly ingestQueue: Queue | undefined,
    @Optional()
    @InjectQueue(QUEUE_FILE_SCAN)
    private readonly scanQueue: Queue | undefined,
    @Optional()
    @InjectQueue(QUEUE_FILE_SHARE_NOTIFY)
    private readonly shareNotifyQueue: Queue | undefined,
    private readonly ingestHandler: FileIngestHandler,
    private readonly scanHandler: FileScanHandler,
    private readonly shareNotifyHandler: FileShareNotifyHandler,
  ) {
    this.async = !!this.ingestQueue;
    this.logger.log(
      `File queue running in ${this.async ? 'async (Redis/BullMQ)' : 'inline'} mode`,
    );
  }

  async enqueueIngest(data: IngestJobData): Promise<void> {
    if (this.ingestQueue) {
      await this.ingestQueue.add('ingest', data, JOB_OPTS);
      return;
    }
    await this.runInline('ingest', () => this.ingestHandler.run(data));
  }

  async enqueueScan(data: ScanJobData): Promise<void> {
    if (this.scanQueue) {
      await this.scanQueue.add('scan', data, JOB_OPTS);
      return;
    }
    await this.runInline('scan', () => this.scanHandler.run(data));
  }

  async enqueueShareNotify(data: ShareNotifyJobData): Promise<void> {
    if (this.shareNotifyQueue) {
      await this.shareNotifyQueue.add('share-notify', data, JOB_OPTS);
      return;
    }
    await this.runInline('share-notify', () =>
      this.shareNotifyHandler.run(data),
    );
  }

  /** Inline fallback: run the handler now, but never let it break the caller. */
  private async runInline(
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `Inline ${label} job failed: ${(err as Error).message}`,
      );
    }
  }
}
