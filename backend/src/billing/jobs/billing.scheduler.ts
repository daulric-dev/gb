import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { billingEnabled } from '../config/billing.config';
import { SeatService } from '../subscriptions/seat.service';
import { SubscriptionService } from '../subscriptions/subscription.service';

const HOUR_MS = 60 * 60 * 1000;
const FIRST_RUN_MS = 30 * 1000;
/** How long a lease holds if its holder dies without releasing it. */
const LEASE_SECONDS = 30 * 60;

/**
 * Background billing work, like the attendance sweep: a timer per API
 * instance, with a lease row in billing.job_lease so only one instance runs a
 * tick when several are up. The lease is a single short statement, so no
 * transaction or connection stays open while the sweep calls the provider.
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
   * Run `work` while holding the named lease; returns false when another
   * instance holds it. The lease is taken with one atomic upsert that only
   * succeeds when the row is absent or expired, and released in `finally`.
   * An instance that dies mid-sweep loses the lease after LEASE_SECONDS.
   */
  async withLock(name: string, work: () => Promise<void>): Promise<boolean> {
    const holder = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      INSERT INTO billing.job_lease (name, holder, expires_at)
      VALUES (${name}, ${holder}, now() + make_interval(secs => ${LEASE_SECONDS}::int))
      ON CONFLICT (name) DO UPDATE
         SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
       WHERE billing.job_lease.expires_at < now()
      RETURNING true AS locked`;
    if (!rows?.[0]?.locked) return false;
    try {
      await work();
    } finally {
      await this.prisma.$executeRaw`
        DELETE FROM billing.job_lease WHERE name = ${name} AND holder = ${holder}`.catch(
        (err: Error) => this.logger.warn(`Releasing lease ${name} failed: ${err.message}`),
      );
    }
    return true;
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
