import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { billingEnabled } from './billing.config';
import { SeatService } from './seat.service';
import { SubscriptionService } from './subscription.service';

const HOUR_MS = 60 * 60 * 1000;
const FIRST_RUN_MS = 30 * 1000;

/**
 * Background billing work, like the attendance sweep: a timer per API
 * instance, with a Postgres advisory lock so only one instance runs a tick
 * when several are up.
 *
 * Hourly: give schools without a row their trial row, end subscriptions
 * whose cancel-at-period-end date has passed, and push per-seat counts to
 * the payment provider.
 */
@Injectable()
export class BillingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly seats: SeatService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !billingEnabled()) return;
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_MS);
    this.timer = setInterval(() => void this.tick(), HOUR_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.timer = undefined;
    this.firstRun = undefined;
  }

  /**
   * Run `work` while holding a transaction-scoped advisory lock; returns false
   * when another instance holds it. The work itself uses ordinary
   * connections - the transaction only pins the lock.
   */
  async withLock(name: string, work: () => Promise<void>): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked`;
        if (!rows?.[0]?.locked) return false;
        await work();
        return true;
      },
      { maxWait: 10_000, timeout: 30 * 60_000 },
    );
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.withLock('gradebook:billing:sweep', async () => {
        const made = await this.subscriptions.ensureAll();
        if (made > 0) this.logger.log(`Started trials for ${made} school(s)`);
        const ended = await this.subscriptions.expireCanceled();
        if (ended > 0) this.logger.log(`Ended ${ended} canceled subscription(s)`);
        const synced = await this.seats.syncAll();
        if (synced > 0) this.logger.log(`Synced seats for ${synced} subscription(s)`);
      });
    } catch (err) {
      this.logger.error(`Billing sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
