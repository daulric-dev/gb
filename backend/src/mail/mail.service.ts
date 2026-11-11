import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { mailFrom, smtpOptions } from './mail.config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * What kind of email this is (`sign_in_code`, `parent_notice`, ...), for
   * the log. Subjects can name students, so they are never logged; this is.
   * Defaults to 'unknown'. Never sent.
   */
  kind?: string;
}

/** A kind that is safe to log: letters, digits, `_`, `.`, `-`; at most 40. */
function logKind(kind: string | undefined): string {
  const clean = (kind ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  return clean || 'unknown';
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly from = mailFrom();
  private transporter: Transporter | null = null;

  /**
   * Check the SMTP login once at boot so a wrong app password shows up in the
   * logs straight away rather than on the first sign-in code. Never fatal:
   * the API still starts and sending retries the connection.
   */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !smtpOptions()) return;
    try {
      await this.transport().verify();
      this.logger.log('SMTP connection verified');
    } catch (err) {
      this.logger.warn(
        `SMTP check failed: ${(err as Error).message}. For Gmail, Outlook and Yahoo use an app password (SMTP_PASSWORD), not the account password.`,
      );
    }
  }

  private transport(): Transporter {
    if (!this.transporter) {
      const options = smtpOptions();
      if (!options) {
        throw new Error(
          'Email is not configured: set SMTP_URL, or SMTP_SERVICE/SMTP_HOST with SMTP_USER and SMTP_PASSWORD',
        );
      }
      this.transporter = nodemailer.createTransport(options);
    }
    return this.transporter;
  }

  /** Whether SMTP is set up at all, for optional mail (security alerts). */
  configured(): boolean {
    try {
      return smtpOptions() !== null;
    } catch {
      return false;
    }
  }

  async send(message: MailMessage): Promise<void> {
    const { kind, ...mail } = message;
    await this.transport().sendMail({ from: this.from, ...mail });
    this.logger.log(`Sent ${logKind(kind)} email to ${redactEmail(message.to)}`);
  }
}

/**
 * j***@school.edu - enough to debug delivery, not enough to harvest. For
 * every log line that would otherwise hold an address.
 */
export function redactEmail(address: string | null | undefined): string {
  const [name, domain] = String(address ?? '').split('@');
  return `${name?.[0] ?? ''}***@${domain ?? ''}`;
}
