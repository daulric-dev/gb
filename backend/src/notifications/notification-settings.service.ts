import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import {
  mergeOff,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  prefsFromRow,
  type NotificationPreferences,
} from './notification-preferences';
import { isPushContent, type PushContent } from './push-content';

export interface PushContentView {
  /** This scope's own value; null = not set (school: follows the organisation). */
  value: PushContent | null;
  /** The organisation's value (school view only, for "follows the organisation"). */
  organisation?: PushContent | null;
}

/**
 * Each account's notification preferences, and the organisation's and each
 * school's push-content setting (what a push shows on the lock screen).
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ── per-account preferences ───────────────────────────────────────────────

  async preferences(userId: string) {
    const row = await this.prisma.notification_preference.findUnique({
      where: { user_profile_id: userId },
      select: { push_off: true, email_off: true },
    });
    return this.view(prefsFromRow(row));
  }

  async updatePreferences(
    userId: string,
    patch: { push?: Record<string, boolean>; email?: Record<string, boolean> },
  ) {
    const current = await this.prisma.notification_preference.findUnique({
      where: { user_profile_id: userId },
      select: { push_off: true, email_off: true },
    });
    const push_off = mergeOff(current?.push_off, patch.push);
    const email_off = mergeOff(current?.email_off, patch.email);
    const row = await this.prisma.notification_preference.upsert({
      where: { user_profile_id: userId },
      create: { user_profile_id: userId, push_off, email_off },
      update: { push_off, email_off, updated_at: new Date() },
      select: { push_off: true, email_off: true },
    });
    return this.view(prefsFromRow(row));
  }

  private view(prefs: NotificationPreferences) {
    return {
      ...prefs,
      categories: NOTIFICATION_CATEGORIES.map((key) => ({
        key,
        label: NOTIFICATION_CATEGORY_LABELS[key],
      })),
    };
  }

  // ── push content ──────────────────────────────────────────────────────────

  async schoolPushContent(schoolId: string): Promise<PushContentView> {
    const [school, organisation] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { push_content: true } }),
      this.prisma.organisation.findFirst({ select: { push_content: true } }),
    ]);
    return {
      value: isPushContent(school?.push_content) ? school.push_content : null,
      organisation: isPushContent(organisation?.push_content) ? organisation.push_content : null,
    };
  }

  async organisationPushContent(): Promise<PushContentView> {
    const organisation = await this.prisma.organisation.findFirst({
      select: { push_content: true },
    });
    return { value: isPushContent(organisation?.push_content) ? organisation.push_content : null };
  }

  async setSchoolPushContent(schoolId: string, value: PushContent | null, actorId: string) {
    this.check(value);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.school.findUnique({
        where: { id: schoolId },
        select: { push_content: true },
      });
      await tx.school.update({ where: { id: schoolId }, data: { push_content: value } });
      await this.audit.record(tx, schoolId, { id: actorId }, {
        entity: 'school',
        entityId: schoolId,
        action: 'update',
        changes: auditChanges(
          { push_content: before?.push_content ?? null },
          { push_content: value },
        ),
      });
    });
    return this.schoolPushContent(schoolId);
  }

  async setOrganisationPushContent(value: PushContent | null, actorId: string) {
    this.check(value);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.organisation.findFirst({ select: { id: true, push_content: true } });
      if (!before) throw new BadRequestException('The organisation is not set up yet');
      await tx.organisation.update({ where: { id: before.id }, data: { push_content: value } });
      await this.audit.record(tx, null, { id: actorId }, {
        entity: 'organisation',
        entityId: before.id,
        action: 'update',
        changes: auditChanges({ push_content: before.push_content ?? null }, { push_content: value }),
      });
    });
    return this.organisationPushContent();
  }

  private check(value: unknown) {
    if (value !== null && !isPushContent(value)) {
      throw new BadRequestException("Push content must be 'full', 'generic' or null");
    }
  }
}
