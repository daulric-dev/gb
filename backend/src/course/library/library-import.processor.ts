import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  LIBRARY_IMPORT_ATTEMPTS,
  QUEUE_LIBRARY_IMPORT,
  type LibraryImportJobData,
} from './library.constants';
import { LibraryImportService } from './library-import.service';

/**
 * BullMQ worker for library imports (Redis mode only). The service does the
 * work and throws to be retried; the last attempt marks the import failed.
 */
@Processor(QUEUE_LIBRARY_IMPORT)
export class LibraryImportProcessor extends WorkerHost {
  constructor(private readonly imports: LibraryImportService) {
    super();
  }

  async process(job: Job<LibraryImportJobData>): Promise<string> {
    const attempts = job.opts.attempts ?? LIBRARY_IMPORT_ATTEMPTS;
    return this.imports.run(job.data.importId, { final: job.attemptsMade + 1 >= attempts });
  }
}
