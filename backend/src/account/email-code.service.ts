import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import { signInCodeEmail } from './templates/sign-in-code';
import { authSecret } from './secret';

export const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
/** Codes one address may be sent in the window, before it must wait. */
const MAX_SENDS = 5;
const SEND_WINDOW_MS = 15 * 60_000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Hash a code with the server secret. A plain hash of an 8-digit code could
 * be reversed by trying all hundred million codes; keyed, a database leak
 * reveals nothing without the secret too.
 */
export function hashCode(email: string, code: string): string {
  return createHmac('sha256', authSecret())
    .update(`${normalizeEmail(email)}:${code}`)
    .digest('hex');
}

/**
 * Email sign-in codes: the passwordless way in for everyone whose school does
 * not require single sign-on.
 *
 * One live code per address - asking again replaces it. A code expires after
 * ten minutes, is used once, and survives five wrong guesses; then the
 * address has to ask for a new one.
 */
@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async send(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const now = Date.now();

    const recent = await this.prisma.email_code.count({
      where: { email, created_at: { gt: new Date(now - SEND_WINDOW_MS) } },
    });
    if (recent >= MAX_SENDS) {
      throw new HttpException(
        'Too many codes requested. Wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = await this.issue(email);

    try {
      await this.mail.send({ to: email, ...signInCodeEmail(code) });
    } catch (err) {
      this.logger.error(`Sign-in code email failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to send the code. Try again shortly.');
    }
  }

  /**
   * Make a new code for an address, retiring any unused one, and return it
   * without sending it. `send` mails it; the dev-only sign-in endpoint hands
   * it straight back to local scripts.
   */
  async issue(rawEmail: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const now = Date.now();
    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');

    await this.prisma.$transaction([
      // The previous code stops working the moment a new one is made.
      this.prisma.email_code.updateMany({
        where: { email, consumed_at: null },
        data: { consumed_at: new Date(now) },
      }),
      this.prisma.email_code.create({
        data: {
          email,
          code_hash: hashCode(email, code),
          expires_at: new Date(now + CODE_TTL_MS),
        },
      }),
    ]);
    return code;
  }

  /**
   * Check a code and use it up. Returns the normalised address on success;
   * every failure is the same 401 so responses say nothing about which part
   * was wrong.
   */
  async verify(rawEmail: string, code: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const invalid = new UnauthorizedException('Invalid or expired code');

    const row = await this.prisma.email_code.findFirst({
      where: { email, consumed_at: null },
      orderBy: { created_at: 'desc' },
    });
    if (!row || row.expires_at.getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS) {
      throw invalid;
    }

    const expected = Buffer.from(row.code_hash, 'hex');
    const given = Buffer.from(hashCode(email, code.trim()), 'hex');
    const matches = expected.length === given.length && timingSafeEqual(expected, given);

    if (!matches) {
      await this.prisma.email_code.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    // Conditional on still being unused, so two simultaneous correct guesses
    // cannot both sign in.
    const used = await this.prisma.email_code.updateMany({
      where: { id: row.id, consumed_at: null },
      data: { consumed_at: new Date() },
    });
    if (used.count !== 1) throw invalid;

    return email;
  }
}
