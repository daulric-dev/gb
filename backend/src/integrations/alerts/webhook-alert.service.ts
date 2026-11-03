import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import { primaryOrigin } from '@/config/origins';
import { SsoAlertService } from '@/sso/sso-alert.service';
import { webhookDisabledEmail, webhookTlsDisabledEmail } from '@/integrations/alerts/webhook-alert.email';

/**
 * Emails the school's admin and every organisation admin when a webhook
 * switches itself off, or when its TLS verification is turned off. Recipients are the same as for single sign-on alerts
 * (SsoAlertService.recipients). Never throws; without SMTP it logs and skips.
 */
@Injectable()
export class WebhookAlertService {
  private readonly logger = new Logger(WebhookAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly ssoAlerts: SsoAlertService,
  ) {}

  async autoDisabled(
    schoolId: string,
    webhook: { id: string; name: string },
    failures: number,
    at = new Date(),
  ): Promise<void> {
    await this.sendAll(schoolId, 'webhook switched-off', (school, settingsUrl) =>
      webhookDisabledEmail({ school, webhook: webhook.name, failures, at, settingsUrl }),
    );
  }

  /** Certificate checks were turned off for a webhook: deliveries can be intercepted. */
  async tlsVerificationDisabled(
    schoolId: string,
    webhook: { id: string; name: string },
    at = new Date(),
  ): Promise<void> {
    await this.sendAll(schoolId, 'TLS verification off', (school, settingsUrl) =>
      webhookTlsDisabledEmail({ school, webhook: webhook.name, at, settingsUrl }),
    );
  }

  private async sendAll(
    schoolId: string,
    what: string,
    build: (school: string, settingsUrl: string) => { subject: string; text: string; html: string },
  ): Promise<void> {
    try {
      if (!this.mail.configured()) {
        this.logger.log(`Email is not configured; skipped the ${what} alert for school ${schoolId}`);
        return;
      }
      const [school, recipients] = await Promise.all([
        this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
        this.ssoAlerts.recipients(schoolId),
      ]);
      const origin = primaryOrigin();
      for (const r of recipients) {
        const settingsUrl = r.orgAdmin
          ? `${origin}/organisation/schools/${schoolId}#integrations`
          : `${origin}/dashboard/settings#integrations`;
        const message = build(school?.name ?? 'your school', settingsUrl);
        try {
          await this.mail.send({ to: r.email, ...message });
        } catch (err) {
          this.logger.warn(`Failed to send a webhook alert for school ${schoolId}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Webhook alert for school ${schoolId} failed: ${(err as Error).message}`);
    }
  }
}
