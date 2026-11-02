import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import { primaryOrigin } from '@/config/origins';
import { normalizeEmail } from '@/account/email-code.service';
import { orgAdminEmails } from '@/organisation/org-admin';
import type { SsoActor, SsoAuditEntry } from './sso-audit.service';
import { ssoChangedEmail } from './sso-alert.email';

/**
 * Whether an audit entry warrants an alert: anything that changes where a
 * domain's people are sent to sign in, or that loosens Require SSO.
 */
export function isAlerting(entry: SsoAuditEntry): boolean {
  switch (entry.action) {
    case 'saml_changed':
    case 'provider_changed':
    case 'azure_tenant_changed':
    case 'app_changed':
    case 'app_secret_changed':
    case 'app_enabled':
    case 'app_disabled':
      return true;
    case 'sso_required_changed': {
      const c = entry.changes.ssoRequired as { after?: unknown } | undefined;
      return c?.after === false;
    }
    default:
      return false;
  }
}

interface Recipient {
  email: string;
  /** Organisation admins get the organisation console's link. */
  orgAdmin: boolean;
}

/**
 * Emails a school's admin and every organisation admin after a committed
 * change to the school's single sign-on settings - the actor included, as
 * confirmation. One email per recipient per request, however many fields
 * changed. Never throws: without SMTP it logs and skips, and a failed send is
 * only logged, so mail can never fail the change.
 */
@Injectable()
export class SsoAlertService {
  private readonly logger = new Logger(SsoAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async notify(
    schoolId: string,
    actor: SsoActor,
    entries: SsoAuditEntry[],
    at = new Date(),
  ): Promise<void> {
    try {
      const alerting = entries.filter(isAlerting);
      if (alerting.length === 0) return;
      if (!this.mail.configured()) {
        this.logger.log(
          `Email is not configured; skipped the single sign-on change alert for school ${schoolId}`,
        );
        return;
      }

      const [school, recipients, actorLabel] = await Promise.all([
        this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
        this.recipients(schoolId),
        this.actorLabel(actor.id),
      ]);
      const origin = primaryOrigin();
      for (const r of recipients) {
        const settingsUrl = r.orgAdmin
          ? `${origin}/organisation/schools/${schoolId}#single-sign-on`
          : `${origin}/dashboard/settings#single-sign-on`;
        const message = ssoChangedEmail({
          school: school?.name ?? 'your school',
          actor: actorLabel,
          via: actor.via,
          at,
          entries: alerting,
          settingsUrl,
        });
        try {
          await this.mail.send({ to: r.email, ...message });
        } catch (err) {
          this.logger.warn(
            `Failed to send a single sign-on change alert for school ${schoolId}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Single sign-on change alert for school ${schoolId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The school's admin (school_management role admin) and every organisation
   * admin: rows in public.organisation_admin, and live accounts with a
   * verified email in ORG_ADMIN_EMAILS. Disabled accounts are left out; an
   * address appears once.
   */
  async recipients(schoolId: string): Promise<Recipient[]> {
    const envEmails = [...orgAdminEmails()];
    const [schoolAdmins, stored, env] = await Promise.all([
      this.prisma.school_management.findMany({
        where: { school_id: schoolId, role: 'admin' },
        select: { user_profile: { select: { app_user: { select: { email: true, disabled_at: true } } } } },
      }),
      this.prisma.organisation_admin.findMany({
        select: { user_profile: { select: { app_user: { select: { email: true, disabled_at: true } } } } },
      }),
      envEmails.length
        ? this.prisma.app_user.findMany({
            where: { email: { in: envEmails }, email_verified_at: { not: null }, disabled_at: null },
            select: { email: true },
          })
        : Promise.resolve([] as { email: string }[]),
    ]);

    const out = new Map<string, Recipient>();
    const add = (email: string | null | undefined, orgAdmin: boolean) => {
      if (!email) return;
      const key = normalizeEmail(email);
      const seen = out.get(key);
      out.set(key, { email: key, orgAdmin: orgAdmin || !!seen?.orgAdmin });
    };
    const live = (u: { email: string; disabled_at: Date | null } | null | undefined) =>
      u && !u.disabled_at ? u.email : null;
    for (const m of schoolAdmins) add(live(m.user_profile?.app_user), false);
    for (const a of stored) add(live(a.user_profile?.app_user), true);
    for (const u of env) add(u.email, true);
    return [...out.values()];
  }

  private async actorLabel(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const p = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { first_name: true, last_name: true, app_user: { select: { email: true } } },
    });
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
    const email = p?.app_user?.email;
    if (name && email) return `${name} (${email})`;
    return name || email || 'An administrator';
  }
}
