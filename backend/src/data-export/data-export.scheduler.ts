import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { DataExportService } from './data-export.service';
import { SWEEP_LOCK, SWEEP_TICK_MS } from './data-export.constants';
import { withJobLease } from '@/common/job-lease';

/**
 * The data export sweep: deletes expired export ZIPs (the purge), removes
 * orphaned ones and resumes exports a restart left behind. Once when the app
 * has booted and then every SWEEP_TICK_MS, in every API instance; a `job_lease`
 * claim lets one instance sweep at a time. Nothing runs under
 * NODE_ENV=test or with DATA_EXPORT_SWEEP=false.
 */
@Injectable()
export class DataExportScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DataExportScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: DataExportService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.DATA_EXPORT_SWEEP === 'false') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), SWEEP_TICK_MS);
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
      await withJobLease(this.prisma, SWEEP_LOCK, 5 * 60_000, async () => {
        const out = await this.exports.sweep(now);
        if (out.expired || out.orphans || out.resumed || out.failed) {
          this.logger.log(
            `Data exports: ${out.expired} expired and deleted, ${out.orphans} orphaned file(s) removed, ${out.resumed} resumed, ${out.failed} given up`,
          );
        }
      });
    } catch (err) {
      this.logger.error(`Data export sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
