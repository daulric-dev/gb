import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { DAY_MS, loadBillingConfig } from './billing.config';
import { BillingRegistry } from './billing.registry';
import { InvoiceService, invoiceDto, type MarkPaidMethod } from './invoice.service';
import { SeatService } from './seat.service';
import { SubscriptionService, type SubscriptionRow } from './subscription.service';

/**
 * The operator's view: every school's billing, invoices and the provider
 * switches. Only platform admins reach it (PlatformAdminGuard).
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BillingRegistry,
    private readonly subscriptions: SubscriptionService,
    private readonly seats: SeatService,
    private readonly invoices: InvoiceService,
  ) {}

  /**
   * A platform admin: listed in billing.platform_admin, or signed in with a
   * verified account email listed in PLATFORM_ADMIN_EMAILS.
   */
  async isPlatformAdmin(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    const row = await this.prisma.platform_admin
      .findUnique({ where: { user_id: userId }, select: { id: true } })
      .catch(() => null);
    if (row) return true;
    const emails = loadBillingConfig().platformAdminEmails;
    if (emails.size === 0) return false;
    const user = await this.prisma.app_user
      .findUnique({
        where: { id: userId },
        select: { email: true, email_verified_at: true, disabled_at: true },
      })
      .catch(() => null);
    return (
      !!user &&
      !!user.email_verified_at &&
      !user.disabled_at &&
      emails.has(user.email.trim().toLowerCase())
    );
  }

  /** Every school with its subscription row (rows made for any school without one). */
  private async rows() {
    await this.subscriptions.ensureAll();
    const [schools, subs, counts, open] = await Promise.all([
      this.prisma.school.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.subscription.findMany(),
      this.seats.countAll(),
      this.prisma.invoice.findMany({
        where: { status: 'open' },
        select: { school_id: true, due_at: true },
        orderBy: { due_at: 'asc' },
      }),
    ]);
    const bySchool = new Map(subs.map((s) => [s.school_id, s]));
    const openBySchool = new Map<string, { count: number; oldest: Date }>();
    for (const inv of open) {
      const cur = openBySchool.get(inv.school_id);
      if (cur) cur.count++;
      else openBySchool.set(inv.school_id, { count: 1, oldest: inv.due_at });
    }
    const now = new Date();
    return schools
      .map((school) => {
        const sub = bySchool.get(school.id);
        if (!sub) return null;
        const openInfo = openBySchool.get(school.id);
        const ent = this.subscriptions.evaluate(sub, openInfo?.oldest ?? null, now);
        const row: SchoolRow = {
            schoolId: school.id,
            name: school.name ?? '',
            plan: sub.plan,
            status: ent.status,
            readOnly: ent.readOnly,
            provider: sub.provider,
            billableUsers: counts.get(school.id) ?? 0,
            trialEndsAt: sub.trial_ends_at?.toISOString() ?? null,
            currentPeriodEnd: sub.current_period_end?.toISOString() ?? null,
            openInvoices: openInfo?.count ?? 0,
        };
        return { sub, row };
      })
      .filter((r): r is { sub: SubscriptionRow; row: SchoolRow } => r !== null);
  }

  async overview() {
    const cfg = loadBillingConfig();
    const all = await this.rows();
    const now = Date.now();
    let mrrCents = 0;
    for (const { sub, row } of all) {
      if (row.readOnly || !sub.plan) continue;
      if (sub.comp_until && sub.comp_until.getTime() > now) continue;
      if (sub.status !== 'active' && sub.status !== 'past_due') continue;
      mrrCents +=
        sub.plan === 'flat' ? cfg.flatCents : cfg.perUserCents * Math.max(1, sub.quantity);
    }
    return {
      schools: all.length,
      trialing: all.filter((r) => r.row.status === 'trialing').length,
      active: all.filter((r) => r.row.status === 'active').length,
      pastDue: all.filter((r) => r.row.status === 'past_due').length,
      readOnly: all.filter((r) => r.row.readOnly).length,
      mrrCents,
      currency: cfg.currency,
      openInvoices: all.reduce((n, r) => n + r.row.openInvoices, 0),
    };
  }

  async schools(search?: string, status?: string) {
    const needle = search?.trim().toLowerCase();
    return (await this.rows())
      .map((r) => r.row)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .filter((r) => !status || r.status === status);
  }

  async school(schoolId: string) {
    const all = await this.rows();
    const found = all.find((r) => r.row.schoolId === schoolId);
    if (!found) throw new NotFoundException('School not found');
    const [invoices, events] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { school_id: schoolId },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.payment_event.findMany({
        where: { school_id: schoolId },
        orderBy: { created_at: 'desc' },
        take: 100,
        select: { provider: true, type: true, created_at: true },
      }),
    ]);
    return {
      ...found.row,
      compUntil: found.sub.comp_until?.toISOString() ?? null,
      compNote: found.sub.comp_note,
      invoices: invoices.map(invoiceDto),
      events: events.map((e) => ({
        provider: e.provider,
        type: e.type,
        createdAt: e.created_at.toISOString(),
      })),
    };
  }

  private async requireSchool(schoolId: string): Promise<SubscriptionRow> {
    const school = await this.prisma.school
      .findUnique({ where: { id: schoolId }, select: { id: true } })
      .catch(() => null);
    if (!school) throw new NotFoundException('School not found');
    return this.subscriptions.ensure(schoolId);
  }

  async extendTrial(schoolId: string, days: number) {
    const sub = await this.requireSchool(schoolId);
    const now = Date.now();
    const from = Math.max(sub.trial_ends_at?.getTime() ?? now, now);
    await this.prisma.subscription.update({
      where: { school_id: schoolId },
      data: { trial_ends_at: new Date(from + days * DAY_MS), updated_at: new Date() },
    });
    await this.subscriptions.invalidate(schoolId);
    return this.school(schoolId);
  }

  async comp(schoolId: string, until: Date, note?: string) {
    if (Number.isNaN(until.getTime())) throw new BadRequestException('Invalid date');
    await this.requireSchool(schoolId);
    await this.prisma.subscription.update({
      where: { school_id: schoolId },
      data: { comp_until: until, comp_note: note ?? null, updated_at: new Date() },
    });
    await this.subscriptions.invalidate(schoolId);
    return this.school(schoolId);
  }

  async listInvoices(status?: string) {
    const rows = await this.prisma.invoice.findMany({
      where: status ? { status } : {},
      orderBy: { created_at: 'desc' },
      take: 500,
      include: { school: { select: { name: true } } },
    });
    return rows.map((r) => ({
      ...invoiceDto(r),
      schoolId: r.school_id,
      schoolName: r.school?.name ?? '',
    }));
  }

  async markPaid(
    id: string,
    input: { method: MarkPaidMethod; reference?: string; note?: string },
    adminUserId: string,
  ) {
    return invoiceDto(await this.invoices.markPaid(id, input, adminUserId));
  }

  async voidInvoice(id: string, note?: string) {
    return invoiceDto(await this.invoices.voidInvoice(id, note));
  }

  async generateInvoices() {
    await this.subscriptions.ensureAll();
    return { created: await this.invoices.sweep() };
  }

  providers() {
    return this.registry.statuses();
  }

  async setProvider(id: string, enabled: boolean, adminUserId: string) {
    if (!this.registry.known(id)) throw new NotFoundException('Unknown provider');
    const status = (await this.registry.statuses()).find((s) => s.id === id)!;
    if (enabled && !(status.allowedByEnv && status.configured)) {
      throw new ConflictException(
        `${status.label} is not allowed by PAYMENT_PROVIDERS or has no credentials`,
      );
    }
    await this.prisma.provider_setting.upsert({
      where: { provider_id: id },
      create: { provider_id: id, enabled, updated_by: adminUserId },
      update: { enabled, updated_by: adminUserId, updated_at: new Date() },
    });
    return (await this.registry.statuses()).find((s) => s.id === id)!;
  }
}

export interface SchoolRow {
  schoolId: string;
  name: string;
  plan: string | null;
  status: string;
  readOnly: boolean;
  provider: string | null;
  billableUsers: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  openInvoices: number;
}
