import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { RosterRunService } from './roster-run.service';
import { ROSTER_DAILY_MS, ROSTER_LOCK, ROSTER_TICK_MS } from './rostering.constants';
import { withJobLease } from '@/common/job-lease';

/**
 * Every ROSTER_TICK_MS (and once on boot), in one instance at a time (a
 * `job_lease` claim): resumes applies a restart interrupted, fails dry
 * runs that never finished, and starts the daily dry run of each source with
 * `schedule = 'daily'` (which auto-applies creates and updates only when the
 * source has auto-apply on; disables always wait for an admin). Nothing runs
 * while `rostering` is off, under NODE_ENV=test, or with
 * ROSTERING_SCHEDULER=false.
 */
@Injectable()
export class RosteringScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RosteringScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly runs: RosterRunService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.ROSTERING_SCHEDULER === 'false') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), ROSTER_TICK_MS);
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
      await withJobLease(this.prisma, ROSTER_LOCK, 60_000, async () => {
        if (!(await this.features.isEnabled(null, 'rostering'))) return;
        await this.runs.resumeStale(now);
        await this.startDaily(now);
      });
    } catch (err) {
      this.logger.error(`Rostering sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async startDaily(now = new Date()): Promise<number> {
    const due = await this.prisma.roster_source.findMany({
      where: {
        schedule: 'daily',
        kind: 'oneroster_api',
        OR: [{ last_scheduled_at: null }, { last_scheduled_at: { lt: new Date(now.getTime() - ROSTER_DAILY_MS) } }],
      },
      select: { id: true },
    });
    let started = 0;
    for (const s of due) {
      await this.prisma.roster_source.update({ where: { id: s.id }, data: { last_scheduled_at: now } });
      try {
        await this.runs.startDryRun(s.id, undefined, null, 'scheduled');
        started++;
      } catch (err) {
        this.logger.warn(`Scheduled sync of source ${s.id} not started: ${(err as Error).message}`);
      }
    }
    return started;
  }
}
