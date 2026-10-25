import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { RetentionService } from './retention.service';
import { intervalHours, maxRunMs, retentionEnabled, runHourUtc } from './retention.config';

const TICK_MS = 15 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Runs the retention purge on a timer in every API instance, like the
 * billing scheduler: a Postgres advisory lock makes sure only one instance
 * purges at a time. Every tick (15 min) also retries the erasure-log export,
 * so an entry whose copy to object storage failed is not left behind.
 *
 * The purge is due once `RETENTION_PURGE_INTERVAL_HOURS` (default 24) have
 * passed since this instance last ran it; with a whole-day interval it waits
 * for `RETENTION_PURGE_HOUR_UTC` (default 3). A second instance running it
 * the same day finds nothing left to do.
 */
@Injectable()
export class RetentionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private running = false;
  private lastPurge = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: RetentionService,
    private readonly erasure: ErasureLogService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (!retentionEnabled()) {
      this.logger.warn('RETENTION_PURGE_ENABLED=false: soft-deleted data is not being purged');
    }
    this.firstRun = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.timer = undefined;
    this.firstRun = undefined;
  }

  /** Whether the purge should run at `now`. */
  isDue(now: number): boolean {
    if (!retentionEnabled()) return false;
    const every = intervalHours() * HOUR_MS;
    // Half a tick of slack so a daily run does not drift later each day.
    if (this.lastPurge && now - this.lastPurge < every - TICK_MS / 2) return false;
    if (intervalHours() % 24 !== 0) return true;
    return new Date(now).getUTCHours() === runHourUtc();
  }

  /** Same pattern as BillingScheduler.withLock: a transaction-scoped advisory lock. */
  async withLock(name: string, work: () => Promise<void>): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked`;
        if (!rows?.[0]?.locked) return false;
        await work();
        return true;
      },
      { maxWait: 10_000, timeout: maxRunMs() + 5 * 60_000 },
    );
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.erasure.exportPending().catch((err: Error) =>
        this.logger.warn(`Erasure log export failed: ${err.message}`),
      );
      if (!this.isDue(now)) return;
      const ran = await this.withLock('gradebook:retention:purge', async () => {
        await this.retention.purge({ now: new Date(now) });
      });
      // Also counts as done when another instance holds the lock: it is
      // purging right now.
      this.lastPurge = now;
      if (!ran) this.logger.log('Retention purge running on another instance');
    } catch (err) {
      this.logger.error(`Retention purge failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
