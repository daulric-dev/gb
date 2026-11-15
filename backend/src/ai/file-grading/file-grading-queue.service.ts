import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AiFileGradingService } from './file-grading.service';
import {
  AI_GRADING_CONCURRENCY,
  AI_GRADING_JOB_OPTS,
  QUEUE_AI_FILE_GRADING,
  aiGradingJobId,
  type AiGradingJobData,
} from './file-grading.constants';

/**
 * Runs AI grading drafts in the background: one job per draft on the BullMQ
 * queue `ai-file-grading` with Redis (USE_REDIS=true and REDIS_URL), else
 * in-process after the request answers, a few at a time. The draft row is
 * the source of truth (the job only carries its id): a cancelled or already
 * claimed draft makes the job a no-op, so either mode is safe to repeat.
 */
@Injectable()
export class AiFileGradingQueueService implements OnModuleInit {
  private readonly logger = new Logger(AiFileGradingQueueService.name);
  private readonly waiting: string[] = [];
  private active = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly grading: AiFileGradingService,
    @Optional()
    @InjectQueue(QUEUE_AI_FILE_GRADING)
    private readonly queue?: Queue<AiGradingJobData>,
  ) {}

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  onModuleInit() {
    this.grading.enqueue = (draftId, delayMs) => this.enqueue(draftId, delayMs);
  }

  async enqueue(draftId: string, delayMs = 0): Promise<void> {
    if (this.queue) {
      // A delayed retry gets its own job id: the first job may still be completing.
      const jobId = delayMs > 0 ? `${aiGradingJobId(draftId)}-${Date.now()}` : aiGradingJobId(draftId);
      await this.queue.add('draft', { draftId }, { ...AI_GRADING_JOB_OPTS, jobId, ...(delayMs > 0 ? { delay: delayMs } : {}) });
      return;
    }
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.push(draftId);
      }, delayMs);
      timer.unref?.();
      this.timers.add(timer);
      return;
    }
    this.push(draftId);
  }

  private push(draftId: string) {
    this.waiting.push(draftId);
    // After the current request, never in its way.
    setImmediate(() => this.drain());
  }

  private drain() {
    while (this.active < AI_GRADING_CONCURRENCY && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      this.active++;
      this.grading
        .process(id)
        .catch((err: Error) => this.logger.error(`AI draft ${id} failed: ${err.message}`))
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  /** Inline mode: drafts waiting in this process (tests). */
  get pending(): number {
    return this.waiting.length + this.active;
  }
}
