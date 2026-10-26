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
const CODE_TTL_MS = 5 * 60_000;
/** Wrong guesses one client address may make at one code. */
export const MAX_ATTEMPTS_PER_CLIENT = 5;
/**
 * Guesses one code takes from all clients together, before it stops working.
 *
 * The brute-force backstop. Every code is 1 of 10^8, and one address is sent
 * at most MAX_SENDS_PER_EMAIL (20) codes an hour, so whoever guesses at an
 * address gets at most 20 x 25 = 500 guesses an hour however many client
 * addresses they use: a 500 / 10^8 = 1-in-200,000 chance per hour, while the
 * owner's inbox fills with 20 codes an hour they never asked for.
 */
export const MAX_TOTAL_ATTEMPTS = 25;
/** Codes one client may have sent to one address in SEND_WINDOW_MS. */
export const MAX_SENDS_PER_CLIENT = 5;
const SEND_WINDOW_MS = 15 * 60_000;
/** Codes one address may be sent in EMAIL_SEND_WINDOW_MS, from anywhere (stops email bombing). */
export const MAX_SENDS_PER_EMAIL = 20;
const EMAIL_SEND_WINDOW_MS = 60 * 60_000;

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
 * Keyed hash of a client address, for the per-client caps. Only the hash is
 * stored; a plain one of an IPv4 address could be reversed by trying them all.
 */
export function hashClient(ip: string | undefined): string {
  return createHmac('sha256', authSecret())
    .update(`client:${ip || 'unknown'}`)
    .digest('hex');
}

/**
 * Email sign-in codes: the passwordless way in for everyone whose school does
 * not require single sign-on.
 *
 * Someone who knows an address must not be able to lock its owner out, so
 * nothing they do from their own client address spends the owner's budget:
 *
 * - Asking again does not retire earlier codes. Every unexpired, unused code
 *   for the address works, and signing in with one uses them all up.
 * - Wrong guesses count per (code, client address): a client gets
 *   MAX_ATTEMPTS_PER_CLIENT at each code; the owner, elsewhere, still has
 *   theirs. MAX_TOTAL_ATTEMPTS across clients ends a code for everyone.
 * - Sends are capped per (address, client) and, more loosely, per address.
 *   Only the per-address cap can stop the owner asking for a code.
 *
 * A code expires after five minutes and is used once.
 */
@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Mail a new code to an address. `ip` is the client asking for it. */
  async send(rawEmail: string, ip?: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const client = hashClient(ip);
    const now = Date.now();

    const [fromClient, toAddress] = await Promise.all([
      this.prisma.email_code.count({
        where: { email, ip_hash: client, created_at: { gt: new Date(now - SEND_WINDOW_MS) } },
      }),
      this.prisma.email_code.count({
        where: { email, created_at: { gt: new Date(now - EMAIL_SEND_WINDOW_MS) } },
      }),
    ]);
    if (fromClient >= MAX_SENDS_PER_CLIENT) {
      throw new HttpException(
        'Too many codes requested. Wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (toAddress >= MAX_SENDS_PER_EMAIL) {
      // Possibly not this client's doing: say what happened, not "you".
      throw new HttpException(
        'Too many sign-in codes have been sent to this address in the last hour. ' +
          'Use a code already sent, or try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = await this.issue(email, ip);

    try {
      await this.mail.send({ to: email, ...signInCodeEmail(code) });
    } catch (err) {
      this.logger.error(`Sign-in code email failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to send the code. Try again shortly.');
    }
  }

  /**
   * Make a new code for an address and return it without sending it. Earlier
   * codes keep working. `send` mails it; the dev-only sign-in endpoint hands
   * it straight back to local scripts.
   */
  async issue(rawEmail: string, ip?: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');

    await this.prisma.email_code.create({
      data: {
        email,
        code_hash: hashCode(email, code),
        expires_at: new Date(Date.now() + CODE_TTL_MS),
        ip_hash: hashClient(ip),
      },
    });
    return code;
  }

  /**
   * Check a code against every live code for the address and, on a match,
   * use them all up. Returns the normalised address on success; every
   * failure is the same 401 so responses say nothing about which part was
   * wrong. `ip` is the client guessing.
   */
  async verify(rawEmail: string, code: string, ip?: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const client = hashClient(ip);
    const invalid = new UnauthorizedException('Invalid or expired code');
    const now = new Date();

    // At most MAX_SENDS_PER_EMAIL codes can be live at once (the TTL is
    // shorter than the per-address send window).
    const live = await this.prisma.email_code.findMany({
      where: {
        email,
        consumed_at: null,
        expires_at: { gt: now },
        attempts: { lt: MAX_TOTAL_ATTEMPTS },
      },
      select: { id: true },
      orderBy: { created_at: 'desc' },
      take: MAX_SENDS_PER_EMAIL,
    });
    if (live.length === 0) throw invalid;
    const ids = live.map((r) => r.id);

    // The guess is tried against every live code, so it takes an attempt at
    // each - before comparing, and conditional on one being left (per client,
    // then in total), so parallel guesses cannot slip in on a stale count.
    await this.prisma.email_code_attempt.createMany({
      data: ids.map((code_id) => ({ code_id, ip_hash: client })),
      skipDuplicates: true,
    });
    const allowed = await this.prisma.email_code_attempt.updateManyAndReturn({
      where: { code_id: { in: ids }, ip_hash: client, attempts: { lt: MAX_ATTEMPTS_PER_CLIENT } },
      data: { attempts: { increment: 1 } },
      select: { code_id: true },
    });
    if (allowed.length === 0) throw invalid;
    const tried = await this.prisma.email_code.updateManyAndReturn({
      where: {
        id: { in: allowed.map((r) => r.code_id) },
        consumed_at: null,
        attempts: { lt: MAX_TOTAL_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
      select: { id: true, code_hash: true },
    });

    const given = Buffer.from(hashCode(email, code.trim()), 'hex');
    let match: string | undefined;
    // Compare against every code, matched or not, so timing says nothing
    // about which (or whether an earlier one) matched.
    for (const row of tried) {
      const expected = Buffer.from(row.code_hash, 'hex');
      if (expected.length === given.length && timingSafeEqual(expected, given)) match ??= row.id;
    }
    if (!match) throw invalid;

    // Conditional on still being unused, so two simultaneous correct guesses
    // cannot both sign in.
    const usedAt = new Date();
    const used = await this.prisma.email_code.updateMany({
      where: { id: match, consumed_at: null },
      data: { consumed_at: usedAt },
    });
    if (used.count !== 1) throw invalid;
    // Signed in: the address's other codes are no longer needed.
    await this.prisma.email_code.updateMany({
      where: { email, consumed_at: null },
      data: { consumed_at: usedAt },
    });

    return email;
  }
}
