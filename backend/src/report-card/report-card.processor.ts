import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_REPORT_CARD_GENERATE, REPORT_JOB_ATTEMPTS, type ReportCardJobData } from './report-card.constants';
import { ReportGenerationService } from './report-generation.service';

/**
 * BullMQ worker for report generation (Redis mode only; see
 * ReportCardModule.forRoot). A thin adapter: the service does the work and
 * throws to have BullMQ retry; the row is marked failed on the last attempt.
 */
@Processor(QUEUE_REPORT_CARD_GENERATE)
export class ReportCardProcessor extends WorkerHost {
  constructor(private readonly generation: ReportGenerationService) {
    super();
  }

  async process(job: Job<ReportCardJobData>): Promise<string> {
    const run = job.attemptsMade + 1;
    const attempts = job.opts.attempts ?? REPORT_JOB_ATTEMPTS;
    // A job resumed after a restart carries the attempts already made.
    const attempt = (job.data.attemptOffset ?? 0) + run;
    return this.generation.generate(job.data, { attempt, final: run >= attempts });
  }
}
