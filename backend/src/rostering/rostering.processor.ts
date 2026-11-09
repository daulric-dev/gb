import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_ROSTER_SYNC, type RosterJobData } from './rostering.constants';
import { RosterRunService } from './roster-run.service';

/** BullMQ worker for dry runs and applies (Redis mode only). */
@Processor(QUEUE_ROSTER_SYNC)
export class RosteringProcessor extends WorkerHost {
  constructor(private readonly runs: RosterRunService) {
    super();
  }

  async process(job: Job<RosterJobData>): Promise<void> {
    await this.runs.runJob(job.data);
  }
}
