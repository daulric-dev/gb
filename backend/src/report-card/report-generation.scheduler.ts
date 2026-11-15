import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ReportGenerationService } from './report-generation.service';
import { REPORT_RESUME_LOCK, REPORT_RESUME_TICK_MS } from './report-card.constants';
import { withJobLease } from '@/common/job-lease';

/**
 * Picks up report card PDFs a restart left behind (see
 * ReportGenerationService.resumeStale): once when the app has booted and
 * then every REPORT_RESUME_TICK_MS, in every API instance. A `job_lease`
 * claim lets one instance sweep at a time (as the retention and
 * parent notice schedulers do). Nothing runs under NODE_ENV=test or with
 * REPORT_GENERATION_SWEEP=false.
 */
@Injectable()
export class ReportGenerationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportGenerationScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: ReportGenerationService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.REPORT_GENERATION_SWEEP === 'false') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), REPORT_RESUME_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One sweep, if this instance gets the lock. Never throws. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withJobLease(this.prisma, REPORT_RESUME_LOCK, 5 * 60_000, async () => {
        const out = await this.generation.resumeStale(now);
        if (out.failed > 0) {
          this.logger.warn(`${out.failed} interrupted report card PDF(s) had no attempts left: marked failed`);
        }
      });
    } catch (err) {
      this.logger.error(`Report card resume sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
