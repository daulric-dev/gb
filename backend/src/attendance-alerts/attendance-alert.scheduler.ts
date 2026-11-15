import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AttendanceAlertService } from './attendance-alert.service';
import { withJobLease } from '@/common/job-lease';

const TICK_MS = 60 * 60 * 1000;
const FIRST_TICK_MS = 5 * 60 * 1000;

/**
 * Runs the attendance alert sweep every hour in every API instance; a
 * `job_lease` claim lets one instance sweep at a time (as the parent
 * notice and retention sweeps do), so it works without Redis. Nothing runs
 * under NODE_ENV=test or with ATTENDANCE_ALERTS_SWEEP=false.
 */
@Injectable()
export class AttendanceAlertScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceAlertScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AttendanceAlertService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.ATTENDANCE_ALERTS_SWEEP === 'false') return;
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
      await withJobLease(this.prisma, 'gradebook:attendance-alerts', 10 * 60_000, async () => {
        const opened = await this.alerts.sweep(now);
        if (opened > 0) this.logger.log(`Opened ${opened} attendance alerts`);
      });
    } catch (err) {
      this.logger.error(`Attendance alert sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
