import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { acquireJobLease, releaseJobLease } from '@/common/job-lease';
import { PeerReviewService } from './peer-review.service';

export const PEER_REVIEW_TICK_MS = 60_000;
export const PEER_REVIEW_LEASE = 'gradebook:peer-review-sweep';
const PEER_REVIEW_LEASE_MS = 10 * 60_000;

/**
 * Opens peer review windows whose due date has passed and tells authors
 * when their reviews are ready, once a minute (reads also open a due window
 * on the spot). A persisted lease lets one instance sweep at a time.
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
      const ownerToken = await acquireJobLease(
        this.prisma,
        PEER_REVIEW_LEASE,
        PEER_REVIEW_LEASE_MS,
      );
      if (!ownerToken) return;
      try {
        await this.peerReview.sweep(now);
      } finally {
        await releaseJobLease(this.prisma, PEER_REVIEW_LEASE, ownerToken);
      }
    } catch (err) {
      this.logger.error(`Peer review sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
