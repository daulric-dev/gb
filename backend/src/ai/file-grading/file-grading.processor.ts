import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AI_GRADING_CONCURRENCY, QUEUE_AI_FILE_GRADING, type AiGradingJobData } from './file-grading.constants';
import { AiFileGradingService } from './file-grading.service';

/** BullMQ worker for AI grading drafts (Redis mode only). */
@Processor(QUEUE_AI_FILE_GRADING, { concurrency: AI_GRADING_CONCURRENCY })
export class AiFileGradingProcessor extends WorkerHost {
  constructor(private readonly grading: AiFileGradingService) {
    super();
  }

  async process(job: Job<AiGradingJobData>) {
    return this.grading.process(job.data.draftId);
  }
}
