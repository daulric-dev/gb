import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from = process.env.MAIL_FROM ?? 'GradeBook <no-reply@localhost>';
  private transporter: Transporter | null = null;

  private transport(): Transporter {
    if (!this.transporter) {
      const url = process.env.SMTP_URL;
      if (!url) throw new Error('SMTP_URL is not set; email cannot be sent');
      this.transporter = nodemailer.createTransport(url);
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
