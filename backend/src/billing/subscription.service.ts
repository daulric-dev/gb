import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { isUniqueViolation } from '@/common/db-values';
import type { subscription } from '@/generated/prisma/client';
import { loadBillingConfig } from './billing.config';
import {
  computeEntitlement,
  initialTrialEnd,
  type Entitlement,
} from './billing.entitlement';

export type SubscriptionRow = subscription;

export interface SchoolEntitlement extends Entitlement {
  trialEndsAt: string | null;
}

/** How long a school's entitlement and a user's school are cached (seconds). */
export const ENTITLEMENT_TTL = 60;
export const ENTITLEMENT_PREFIX = 'billing:ent:';
export const USER_SCHOOL_PREFIX = 'billing:user-school:';

/**
 * The subscription row of each school and what it entitles the school to.
 *
 * Rows are created lazily - on a school's first billing-relevant request, or
 * by the hourly sweep for every school without one - with a trial of
 * BILLING_TRIAL_DAYS from max(school created, now). So on the first deploy
 * with billing on, existing schools get a full trial from that day rather
 * than from their old creation date.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async ensure(schoolId: string, now = new Date()): Promise<SubscriptionRow> {
    const existing = await this.prisma.subscription.findUnique({
      where: { school_id: schoolId },
    });
    if (existing) return existing;

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { created_at: true },
    });
    const trialEnd = initialTrialEnd(
      school?.created_at ?? null,
      now,
      loadBillingConfig().trialDays,
    );
    try {
      return await this.prisma.subscription.create({
        data: { school_id: schoolId, status: 'trialing', trial_ends_at: trialEnd },
      });
    } catch (err) {
      // Another request created it first.
      if (!isUniqueViolation(err)) throw err;
      return this.prisma.subscription.findUniqueOrThrow({
        where: { school_id: schoolId },
      });
    }
  }

  /** Give every school without a row its trial row. Returns how many were made. */
  async ensureAll(): Promise<number> {
    const days = loadBillingConfig().trialDays;
    return this.prisma.$executeRaw`
      INSERT INTO billing.subscription (school_id, status, trial_ends_at)
      SELECT s.id, 'trialing',
             GREATEST(COALESCE(s.created_at, now()), now()) + make_interval(days => ${days}::int)
        FROM public.school s
       WHERE NOT EXISTS (SELECT 1 FROM billing.subscription b WHERE b.school_id = s.id)
      ON CONFLICT (school_id) DO NOTHING`;
  }

  /**
   * End subscriptions set to cancel at period end once that period is over.
   * Stripe ends them itself (customer.subscription.deleted); the hourly sweep
   * is a backstop for a missed webhook and for rows whose provider is gone.
   * Returns how many ended.
   */
  async expireCanceled(now = new Date()): Promise<number> {
    const due = await this.prisma.subscription.findMany({
      where: {
        cancel_at_period_end: true,
        status: { in: ['active', 'trialing', 'past_due'] },
        current_period_end: { lte: now },
      },
      select: { school_id: true },
    });
    if (due.length === 0) return 0;
    const ids = due.map((d) => d.school_id);
    await this.prisma.subscription.updateMany({
      where: { school_id: { in: ids }, cancel_at_period_end: true },
      data: { status: 'canceled', cancel_at_period_end: false, updated_at: now },
    });
    for (const id of ids) await this.invalidate(id);
    return ids.length;
  }

  evaluate(row: SubscriptionRow, now = new Date()): Entitlement {
    return computeEntitlement(
      {
        status: row.status,
        trialEndsAt: row.trial_ends_at,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        compUntil: row.comp_until,
      },
      now,
      loadBillingConfig().graceDays,
    );
  }

  /** A school's entitlement, cached briefly; every billing write invalidates it. */
  async entitlement(schoolId: string): Promise<SchoolEntitlement> {
    const key = `${ENTITLEMENT_PREFIX}${schoolId}`;
    const cached = (await this.cache.get(key)) as SchoolEntitlement | null;
    if (cached && typeof cached.readOnly === 'boolean') return cached;

    const row = await this.ensure(schoolId);
    const result: SchoolEntitlement = {
      ...this.evaluate(row),
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
    };
    await this.cache.set(key, result, ENTITLEMENT_TTL);
    return result;
  }

  async invalidate(schoolId: string | null | undefined): Promise<void> {
    if (!schoolId) return;
    await this.cache.delete(`${ENTITLEMENT_PREFIX}${schoolId}`);
  }

  /**
   * The school a signed-in user belongs to for billing: a student's roster
   * school, otherwise the staff member's active school. Cached briefly.
   */
  async schoolOfUser(userId: string): Promise<string | null> {
    const key = `${USER_SCHOOL_PREFIX}${userId}`;
    const cached = (await this.cache.get(key)) as { schoolId: string | null } | null;
    if (cached && 'schoolId' in cached) return cached.schoolId;

    const profile = await this.prisma.user_profile
      .findUnique({
        where: { id: userId },
        select: {
          school_id: true,
          account_type: true,
          student: { select: { school_id: true } },
        },
      })
      .catch((err: Error) => {
        this.logger.warn(`School lookup failed for ${userId}: ${err.message}`);
        return null;
      });

    const schoolId =
      (profile?.account_type === 'student'
        ? (profile.student?.school_id ?? profile.school_id)
        : profile?.school_id) ?? null;
    await this.cache.set(key, { schoolId }, ENTITLEMENT_TTL);
    return schoolId;
  }
}
