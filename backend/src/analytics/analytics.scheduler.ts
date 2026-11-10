import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

const TICK_MS = 60 * 60 * 1000;
const FIRST_TICK_MS = 3 * 60 * 1000;
/** "Refresh now" is ignored this soon after the last refresh. */
export const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
export const ANALYTICS_LOCK = 'gradebook:analytics';

/**
 * Refreshes every school's analytics summaries hourly in every API
 * instance; a Postgres advisory lock lets one instance work at a time (as
 * the attendance alert and parent notice sweeps do), so it works without
 * Redis. Nothing runs under NODE_ENV=test or with ANALYTICS_SWEEP=false;
 * "refresh now" still works there.
 */
@Injectable()
export class AnalyticsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.ANALYTICS_SWEEP === 'false') return;
    this.firstRun = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  /** Run `work` while holding the analytics lock; false when another holder has it. */
  async locked(work: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    let ran = false;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext(${ANALYTICS_LOCK})) AS locked`;
          if (!rows?.[0]?.locked) return;
          ran = true;
          await work();
        },
        { maxWait: 10_000, timeout: 30 * 60_000 },
      );
    } catch (err) {
      this.logger.error(`Analytics refresh failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return ran;
  }

  async tick(now = new Date()): Promise<void> {
    await this.locked(async () => {
      const n = await this.analytics.sweep(now);
      if (n > 0) this.logger.log(`Refreshed analytics for ${n} courses`);
    });
  }

  /**
   * "Refresh now" for one school: starts in the background (the request
   * does not wait) unless a refresh is running or the last one is recent.
   */
  async refreshNow(schoolId: string, now = new Date()): Promise<{ started: boolean; lastUpdated: string | null }> {
    const last = await this.prisma.analytics_refresh.findUnique({ where: { school_id: schoolId } });
    const lastUpdated = last?.refreshed_at.toISOString() ?? null;
    if (this.running) return { started: false, lastUpdated };
    if (last && now.getTime() - last.refreshed_at.getTime() < REFRESH_COOLDOWN_MS) {
      return { started: false, lastUpdated };
    }
    void this.locked(async () => {
      await this.analytics.refreshSchool(schoolId, new Date());
    });
    return { started: true, lastUpdated };
  }
}
