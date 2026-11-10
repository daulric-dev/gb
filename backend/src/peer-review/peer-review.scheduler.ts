import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PeerReviewService } from './peer-review.service';

export const PEER_REVIEW_TICK_MS = 60_000;
export const PEER_REVIEW_LOCK = 'gradebook:peer-review-sweep';

/**
 * Opens peer review windows whose due date has passed and tells authors
 * when their reviews are ready, once a minute (reads also open a due window
 * on the spot). A Postgres advisory lock lets one instance sweep at a time.
 * Nothing runs under NODE_ENV=test or with PEER_REVIEW_SWEEP=false.
 */
@Injectable()
export class PeerReviewScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PeerReviewScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly peerReview: PeerReviewService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.PEER_REVIEW_SWEEP === 'false') return;
    this.timer = setInterval(() => void this.tick(), PEER_REVIEW_TICK_MS);
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
      const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(hashtext(${PEER_REVIEW_LOCK})) AS locked`;
      if (!rows?.[0]?.locked) return;
      try {
        await this.peerReview.sweep(now);
      } finally {
        await this.prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext(${PEER_REVIEW_LOCK}))`;
      }
    } catch (err) {
      this.logger.error(`Peer review sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
