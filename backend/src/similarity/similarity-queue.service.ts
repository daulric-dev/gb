import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SubmissionEvents } from '@/grading/submission-events';
import { SimilarityService } from './similarity.service';
import {
  QUEUE_SIMILARITY_CHECK,
  SIMILARITY_JOB_OPTS,
  similarityJobId,
  type SimilarityJobData,
} from './similarity.constants';

/**
 * Runs a similarity check after each hand-in: on the BullMQ queue with
 * Redis (USE_REDIS=true and REDIS_URL), otherwise in-process after the
 * request answers. The check itself is idempotent, so a retry or a second
 * event for the same text does nothing new.
 */
@Injectable()
export class SimilarityQueueService implements OnModuleInit {
  private readonly logger = new Logger(SimilarityQueueService.name);

  constructor(
    private readonly similarity: SimilarityService,
    @Optional() private readonly events?: SubmissionEvents,
    @Optional()
    @InjectQueue(QUEUE_SIMILARITY_CHECK)
    private readonly queue?: Queue<SimilarityJobData>,
  ) {}

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  onModuleInit() {
    this.events?.onHandedIn((event) => this.enqueue(event.submissionId));
  }

  async enqueue(submissionId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'check',
        { submissionId },
        { ...SIMILARITY_JOB_OPTS, jobId: similarityJobId(submissionId) },
      );
      return;
    }
    // Inline: after the current request, never in its way.
    setImmediate(() => {
      this.similarity.process(submissionId).catch((err: Error) => {
        this.logger.error(`Similarity check for ${submissionId} failed: ${err.message}`);
      });
    });
  }
}
