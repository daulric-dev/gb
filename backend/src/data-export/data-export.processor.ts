import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EXPORT_JOB_ATTEMPTS, QUEUE_DATA_EXPORT, type DataExportJobData } from './data-export.constants';
import { DataExportService } from './data-export.service';

/**
 * BullMQ worker for data exports (Redis mode only; see DataExportModule). A
 * thin adapter: the service builds the export and throws to have BullMQ
 * retry; the row is marked failed on the last attempt.
 */
@Processor(QUEUE_DATA_EXPORT)
export class DataExportProcessor extends WorkerHost {
  constructor(private readonly exports: DataExportService) {
    super();
  }

  async process(job: Job<DataExportJobData>): Promise<string> {
    const attempts = job.opts.attempts ?? EXPORT_JOB_ATTEMPTS;
    return this.exports.run(job.data.exportId, { final: job.attemptsMade + 1 >= attempts });
  }
}
