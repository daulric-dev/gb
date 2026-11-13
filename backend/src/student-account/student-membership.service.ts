import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { WebhookEvents } from '@/integrations/events';
import { isoDate } from '@/common/db-values';
import { CacheService } from '@/cache/cache.service';

/**
 * Ambiguous glyphs are omitted: these codes get read off paper and typed by
 * hand, and I/1/L and O/0 are the pairs people get wrong.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12; // ~59 bits over a 31-character alphabet
const GROUP_SIZE = 4;

const DEFAULT_TTL_DAYS = 14;
const MAX_TTL_DAYS = 90;

/** Dev-only fallback so local setups work without extra configuration. */
const DEV_PEPPER = 'dev-insecure-student-claim-pepper';

/**
 * Everything that binds a login to a school as a student.
 *
 * This is deliberately the only place that writes student membership. It used
 * to be spread over three services with three RPCs, and each one had to
 * remember to invalidate four cache keys by hand - the misses were invisible
 * (stranded on the join screen, missing from the roster) and long-lived,
 * because two of those keys hold for thirty days. Every write here ends at
 * `finalise`, so there is one place to get that right.
 */
@Injectable()
export class StudentMembershipService {
  private readonly logger = new Logger(StudentMembershipService.name);
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @Optional() private readonly webhooks?: WebhookEvents,
  ) {
    const configured = process.env.STUDENT_CLAIM_CODE_PEPPER?.trim();

    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        // Fail closed. Without a secret pepper, anyone who reads the join-code
        // table can brute-force a 59-bit code offline and join the school.
        throw new Error(
          'STUDENT_CLAIM_CODE_PEPPER is required in production (join codes are stored as keyed hashes).',
        );
      }
      this.logger.warn(
        'No STUDENT_CLAIM_CODE_PEPPER set - join codes use a well-known dev pepper (dev only).',
      );
    }

    this.pepper = configured || DEV_PEPPER;
  }

  // ── codes ─────────────────────────────────────────────────────────────────

  /** Strip formatting so "abcd-efgh-jkmn" and "ABCDEFGHJKMN" are one code. */
  private normalize(code: string): string {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Keyed hash, not a bare digest: the pepper is what makes a leaked table
   * useless. Deterministic so redemption is an indexed lookup.
   */
  private hash(code: string): string {
    return createHmac('sha256', this.pepper)
      .update(this.normalize(code))
      .digest('hex');
  }

  /** Unbiased sampling - randomInt rejects modulo-skewed draws internally. */
  private generateCode(): string {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
    }
    return out;
  }

  /** Group for display: RXKT-9WMB-2FQH. */
  private format(code: string): string {
    return (code.match(new RegExp(`.{1,${GROUP_SIZE}}`, 'g')) ?? []).join('-');
  }

  // ── cache ─────────────────────────────────────────────────────────────────

  /**
   * The one place membership caches are dropped. `profile` and `students` hold
   * for thirty days, so a miss here is effectively permanent: the client keeps
   * seeing no school, or the roster keeps omitting the student.
   */
  private async finalise(userId: string, schoolId: string): Promise<void> {
    await this.cache.delete(`profile:${userId}`);
    await this.cache.delete(`student-context:${userId}`);
    await this.cache.delete(`students:${schoolId}`);
  }

  /** The acting staff member's school, which every code is scoped to. */
  private async requireActorSchool(actorUserId: string): Promise<string> {
    const actor = await this.prisma.user_profile
      .findUnique({ where: { id: actorUserId }, select: { school_id: true } })
      .catch(() => null);

    if (!actor?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    return actor.school_id;
  }

  // ── school join code ──────────────────────────────────────────────────────

  /** Issue (or reissue) the school's join code, superseding any live one. */
  async issueCode(
    actorUserId: string,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ code: string; expiresAt: string }> {
    if (!Number.isFinite(ttlDays) || ttlDays < 1 || ttlDays > MAX_TTL_DAYS) {
      throw new BadRequestException(
        `Expiry must be between 1 and ${MAX_TTL_DAYS} days`,
      );
    }

    const schoolId = await this.requireActorSchool(actorUserId);

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    // One live code per school is a database constraint: replace the
    // previous one in the same transaction, so a failed insert keeps it.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.school_join_code.deleteMany({
          where: { school_id: schoolId, revoked_at: null },
        });
        await tx.school_join_code.create({
          data: {
            school_id: schoolId,
            code_hash: this.hash(code),
            expires_at: expiresAt,
            created_by: actorUserId,
          },
        });
      });
    } catch (err) {
      this.logger.error(
        `Failed to issue join code for ${schoolId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to issue join code');
    }

    return { code: this.format(code), expiresAt: expiresAt.toISOString() };
  }

  /** Invalidate the school's live join code, if any. */
  async revokeCode(actorUserId: string): Promise<void> {
    const schoolId = await this.requireActorSchool(actorUserId);

    try {
      await this.prisma.school_join_code.deleteMany({
        where: { school_id: schoolId, revoked_at: null },
      });
    } catch (err) {
      this.logger.error(
        `Failed to revoke join code for ${schoolId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to revoke join code');
    }
  }

  /** Whether a live code exists, and when it lapses. Never the code itself. */
  async getCodeStatus(actorUserId: string) {
    const schoolId = await this.requireActorSchool(actorUserId);

    const data = await this.prisma.school_join_code
      .findFirst({
        where: { school_id: schoolId, revoked_at: null },
        select: { expires_at: true, created_at: true },
      })
      .catch(() => null);

    const expired = data ? data.expires_at <= new Date() : false;

    return {
      activeCode:
        data && !expired
          ? {
              expiresAt: isoDate(data.expires_at),
              issuedAt: isoDate(data.created_at),
            }
          : null,
      expired,
    };
  }

  /**
   * Redeem the school's join code: creates the caller's student record and
   * binds their profile. The code is not consumed - it stays valid for the
   * next student until it expires or is revoked.
   */
  async joinByCode(
    userId: string,
    rawCode: string,
  ): Promise<{ studentId: string; schoolId: string }> {
    const account = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true },
    });
    if (account?.account_type === 'parent') {
      // Parents link to children with a parent code, never a student join.
      throw new ConflictException('A parent account cannot join a school as a student');
    }

    const normalized = this.normalize(rawCode);

    if (normalized.length !== CODE_LENGTH) {
      // Same error as a wrong code: the length of a valid one is not a hint.
      throw new BadRequestException('Invalid or expired join code');
    }

    let row: { student_id: string; school_id: string };
    try {
      row = await this.redeem(userId, this.hash(normalized));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Join failed for user ${userId}: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to redeem join code');
    }

    await this.finalise(userId, row.school_id);
    const studentId = row.student_id;
    void this.webhooks?.emit(row.school_id, 'student.joined_school', async () => ({
      student: await this.webhooks!.student(studentId),
      via: 'join_code',
    }));

    this.logger.log(
      `User ${userId} joined school ${row.school_id} as student ${row.student_id}`,
    );

    return { studentId: row.student_id, schoolId: row.school_id };
  }

  /**
   * The redemption itself, in one transaction (formerly the SQL function
   * `public.redeem_school_join_code`): find a live code by its hash, create
   * the student record from the profile's name and bind the profile to the
   * school. The bind is a compare-and-set on `school_id IS NULL`, so a
   * concurrent join or staff assignment that settled the profile first rolls
   * this one back instead of leaving a second record; the partial unique
   * index on `student.user_profile_id` backs that up. The code is not
   * consumed. No school_management row: students are not staff members.
   */
  private async redeem(
    userId: string,
    codeHash: string,
  ): Promise<{ student_id: string; school_id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const code = await tx.school_join_code.findFirst({
        where: {
          code_hash: codeHash,
          revoked_at: null,
          expires_at: { gt: new Date() },
        },
        select: { school_id: true },
      });
      if (!code) throw new BadRequestException('Invalid or expired join code');

      const profile = await tx.user_profile.findUnique({
        where: { id: userId },
        select: { first_name: true, last_name: true, school_id: true },
      });
      if (!profile) throw new BadRequestException('Complete your profile first');
      // Already settled somewhere; joining again would orphan the first record.
      if (profile.school_id) {
        throw new ConflictException('This account already belongs to a school');
      }

      const student = await tx.student.create({
        data: {
          school_id: code.school_id,
          first_name: profile.first_name,
          last_name: profile.last_name,
          user_profile_id: userId,
          is_active: true,
        },
        select: { id: true },
      });

      const bound = await tx.user_profile.updateMany({
        where: { id: userId, school_id: null },
        data: {
          school_id: code.school_id,
          account_type: 'student',
          role: null,
          is_active: true,
        },
      });
      if (bound.count !== 1) {
        throw new ConflictException('This account already belongs to a school');
      }
      return { student_id: student.id, school_id: code.school_id };
    });
  }
}
