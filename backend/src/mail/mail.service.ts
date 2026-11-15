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
        `SMTP check failed: ${stripEmails((err as Error).message)}. For Gmail, Outlook and Yahoo use an app password (SMTP_PASSWORD), not the account password.`,
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

  /**
   * Send one email. A failure is rethrown with every email address in its
   * message redacted (SMTP servers echo the recipient: "550 <jane@...>:
   * mailbox unavailable"), so callers can log it as it is.
   */
  async send(message: MailMessage): Promise<void> {
    const { kind, ...mail } = message;
    try {
      await this.transport().sendMail({ from: this.from, ...mail });
    } catch (err) {
      throw redactMailError(err);
    }
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

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const DOMAIN_CHAR = /[A-Za-z0-9.-]/;
const LETTER = /[A-Za-z]/;

/**
 * `text` with every email address in it redacted (see redactEmail).
 *
 * Scans out from each '@' rather than matching a pattern. The obvious
 * pattern for the domain - `[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`
 * - lets a trailing '.abc' be taken either by one more turn of the group or
 * by the final part, so a string like 'a@b.c.c.c.c.c!' can be split many ways
 * and the match is polynomial in its length. That is what code scanning
 * reports as a backtracking risk (CWE-1333), and this runs over SMTP error
 * text, which the far end writes. The scan below visits each character a
 * bounded number of times. src/ai/redact.ts does the same thing for the same
 * reason.
 *
 * The regular expressions left here match one character and carry no
 * quantifier, so there is nothing to backtrack over.
 */
export function stripEmails(text: string): string {
  let out = '';
  let copied = 0;

  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at < copied) continue;

    // The local part: back from '@' while the characters can belong to one.
    let start = at;
    while (start > copied && LOCAL_CHAR.test(text[start - 1])) start--;

    // The domain: forward from '@', then trim trailing dots and hyphens.
    let end = at + 1;
    while (end < text.length && DOMAIN_CHAR.test(text[end])) end++;
    while (end > at + 1 && (text[end - 1] === '.' || text[end - 1] === '-')) end--;

    const domain = text.slice(at + 1, end);
    const domainLength = addressableDomainLength(domain);
    if (start === at || domainLength === 0) continue;

    const addressEnd = at + 1 + domainLength;
    out += text.slice(copied, start) + redactEmail(text.slice(start, addressEnd));
    copied = addressEnd;
    at = addressEnd - 1;
  }

  return out + text.slice(copied);
}

/**
 * How much of `domain` is an address worth redacting: the longest prefix that
 * ends in a dot followed by two or more letters. 0 when there is none.
 *
 * Stopping inside the last label is the point, not an accident. A domain that
 * ends in digits or hyphens still carries an address a reader must not see:
 * `example.xn--p1ai` (an internationalised domain, which real school
 * addresses use) and `x.org1` (a bounce message that appended something) both
 * have a perfectly good address in front of them. Taking the whole run and
 * demanding the final label be letters would redact neither, and the address
 * would reach the log in full. So this walks every dot and keeps the furthest
 * one with a usable label after it - `example.xn` out of `example.xn--p1ai`,
 * `mail.example` out of `mail.example.c0m` - and redacts up to there. The
 * trailing characters stay, which is harmless; the address does not.
 */
function addressableDomainLength(domain: string): number {
  let best = 0;
  for (let dot = domain.indexOf('.'); dot !== -1; dot = domain.indexOf('.', dot + 1)) {
    let letters = dot + 1;
    while (letters < domain.length && LETTER.test(domain[letters])) letters++;
    // Needs a label before the dot, and two or more letters after it.
    if (dot > 0 && letters - (dot + 1) >= 2) best = letters;
  }
  return best;
}

/**
 * The same error with email addresses redacted from its message (and
 * nodemailer's `response` and `rejected` fields dropped), keeping its class
 * name and SMTP `code` / `responseCode` for the log.
 */
export function redactMailError(err: unknown): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const out = new Error(stripEmails(original.message));
  out.name = original.name;
  const extra = original as Error & { code?: unknown; responseCode?: unknown };
  if (extra.code !== undefined) (out as Error & { code?: unknown }).code = extra.code;
  if (extra.responseCode !== undefined) (out as Error & { responseCode?: unknown }).responseCode = extra.responseCode;
  return out;
}
