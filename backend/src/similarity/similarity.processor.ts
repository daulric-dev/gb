import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_SIMILARITY_CHECK, type SimilarityJobData } from './similarity.constants';
import { SimilarityService } from './similarity.service';

/** BullMQ worker for similarity checks (Redis mode only). */
@Processor(QUEUE_SIMILARITY_CHECK)
export class SimilarityProcessor extends WorkerHost {
  constructor(private readonly similarity: SimilarityService) {
    super();
  }

  async process(job: Job<SimilarityJobData>) {
    return this.similarity.process(job.data.submissionId);
  }
}
