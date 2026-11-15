import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ParentNotificationService } from './parent-notification.service';
import { withJobLease } from '@/common/job-lease';

const TICK_MS = 15 * 60 * 1000;
const FIRST_TICK_MS = 2 * 60 * 1000;

/**
 * Runs the parent notice sweep every 15 minutes in every API instance; a
 * `job_lease` claim lets one instance sweep at a time (as the
 * retention scheduler does). Nothing runs under NODE_ENV=test or with
 * PARENT_NOTIFICATIONS_SWEEP=false.
 */
@Injectable()
export class ParentNotificationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ParentNotificationScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: ParentNotificationService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.PARENT_NOTIFICATIONS_SWEEP === 'false') return;
    this.firstRun = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withJobLease(this.prisma, 'gradebook:parent-notices', 10 * 60_000, async () => {
        const sent = await this.notices.sweep(now);
        if (sent > 0) this.logger.log(`Sent ${sent} parent notices`);
      });
    } catch (err) {
      this.logger.error(`Parent notice sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
