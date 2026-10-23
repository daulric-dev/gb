import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { mailFrom, smtpOptions } from './mail.config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
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

  async send(message: MailMessage): Promise<void> {
    await this.transport().sendMail({ from: this.from, ...message });
    this.logger.log(`Sent "${message.subject}" to ${redact(message.to)}`);
  }
}

/** j***@school.edu - enough to debug delivery, not enough to harvest. */
function redact(address: string): string {
  const [name, domain] = address.split('@');
  return `${name?.[0] ?? ''}***@${domain ?? ''}`;
}
