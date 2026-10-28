import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { BillingRegistry } from '../providers/billing.registry';
import { SubscriptionService } from './subscription.service';

/** Statuses whose provider subscription is live and billed per seat. */
const SYNCED_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * Billable users and keeping per-seat subscriptions in step with them.
 *
 * A billable user is an active staff member of the school (profile active,
 * school is their active school, with a membership there) or an active
 * student on the school's roster. Students without an account still count:
 * the school manages them.
 */
@Injectable()
export class SeatService {
  private readonly logger = new Logger(SeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BillingRegistry,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async countBillable(schoolId: string): Promise<number> {
    const [staff, students] = await Promise.all([
      this.prisma.user_profile.count({
        where: {
          school_id: schoolId,
          account_type: 'staff',
          is_active: true,
          school_management: { some: { school_id: schoolId } },
        },
      }),
      this.prisma.student.count({
        where: { school_id: schoolId, is_active: true },
      }),
    ]);
    return staff + students;
  }

  /** Billable users of every school, in two grouped queries. */
  async countAll(): Promise<Map<string, number>> {
    const [staff, students] = await Promise.all([
      this.prisma.$queryRaw<Array<{ school_id: string; n: number }>>`
        SELECT p.school_id, count(*)::int AS n
          FROM public.user_profile p
         WHERE p.account_type = 'staff' AND p.is_active AND p.school_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.school_management m
                        WHERE m.user_id = p.id AND m.school_id = p.school_id)
         GROUP BY p.school_id`,
      this.prisma.$queryRaw<Array<{ school_id: string; n: number }>>`
        SELECT s.school_id, count(*)::int AS n
          FROM student.student s
         WHERE s.is_active AND s.school_id IS NOT NULL
         GROUP BY s.school_id`,
    ]);
    const counts = new Map<string, number>();
    for (const row of [...staff, ...students]) {
      counts.set(row.school_id, (counts.get(row.school_id) ?? 0) + Number(row.n));
    }
    return counts;
  }

  /**
   * Push the billable count to each per-seat subscription whose provider bills
   * it when it differs from what was last sent. Returns
   * how many were updated.
   */
  async syncAll(): Promise<number> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        plan: 'per_user',
        provider_subscription_id: { not: null },
        // A subscription set to cancel at period end is still billed until
        // then (and may be resumed), so it keeps getting seat updates.
        status: { in: SYNCED_STATUSES },
      },
    });
    if (subs.length === 0) return 0;
    const counts = await this.countAll();
    let updated = 0;
    for (const sub of subs) {
      const ok = await this.syncOne(sub, Math.max(1, counts.get(sub.school_id) ?? 0));
      if (ok) updated++;
    }
    return updated;
  }

  private async syncOne(
    sub: {
      school_id: string;
      plan: string | null;
      provider: string | null;
      provider_subscription_id: string | null;
      provider_customer_id: string | null;
      status: string;
      quantity: number;
    },
    seats: number,
  ): Promise<boolean> {
    if (
      sub.plan !== 'per_user' ||
      !sub.provider_subscription_id ||
      !SYNCED_STATUSES.includes(sub.status) ||
      sub.quantity === seats
    ) {
      return false;
    }
    const provider = this.registry.find(sub.provider);
    if (!provider?.updateQuantity) {
      return false;
    }
    try {
      await provider.updateQuantity(
        {
          providerSubscriptionId: sub.provider_subscription_id,
          providerCustomerId: sub.provider_customer_id,
          plan: 'per_user',
        },
        seats,
      );
    } catch (err) {
      this.logger.error(
        `Seat sync for school ${sub.school_id} (${sub.provider}) failed: ${(err as Error).message}`,
      );
      return false;
    }
    await this.prisma.subscription.update({
      where: { school_id: sub.school_id },
      data: { quantity: seats, updated_at: new Date() },
    });
    await this.subscriptions.invalidate(sub.school_id);
    return true;
  }
}
