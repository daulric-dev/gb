import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { isoDate, pgCode, raisedMessage } from '@/common/db-values';
import { CacheService } from '@/cache/cache.service';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { plan } from '@/erasure/erasure-plan';

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

/** Postgres `undefined_function`: a migration that adds the function is missing. */
const MISSING_FUNCTION = '42883';

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
    private readonly erasure: ErasureLogService,
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
    const normalized = this.normalize(rawCode);

    if (normalized.length !== CODE_LENGTH) {
      // Same error as a wrong code: the length of a valid one is not a hint.
      throw new BadRequestException('Invalid or expired join code');
    }

    let rows: { student_id: string | null; school_id: string | null }[];
    try {
      rows = await this.prisma.$queryRaw`
        SELECT student_id, school_id
        FROM public.redeem_school_join_code(
          ${userId}::uuid,
          ${this.hash(normalized)}::text
        )`;
    } catch (error) {
      const detail = raisedMessage(error);

      if (detail.includes('already_in_a_school')) {
        throw new ConflictException('This account already belongs to a school');
      }
      if (detail.includes('profile_not_found')) {
        throw new BadRequestException('Complete your profile first');
      }
      if (detail.includes('invalid_join_code')) {
        throw new BadRequestException('Invalid or expired join code');
      }
      if (pgCode(error) === MISSING_FUNCTION) {
        this.logger.error(
          `redeem_school_join_code is missing from the database. Apply the pending migrations. Detail: ${(error as Error).message}`,
        );
        throw new BadRequestException(
          'Joining by code is unavailable: the database is missing redeem_school_join_code. Apply the pending migrations.',
        );
      }

      this.logger.error(
        `Join failed for user ${userId}: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to redeem join code');
    }

    const row = rows[0];

    if (!row?.student_id || !row?.school_id) {
      throw new BadRequestException('Invalid or expired join code');
    }

    await this.finalise(userId, row.school_id);

    this.logger.log(
      `User ${userId} joined school ${row.school_id} as student ${row.student_id}`,
    );

    return { studentId: row.student_id, schoolId: row.school_id };
  }

  // ── duplicates ────────────────────────────────────────────────────────────

  /**
   * Students who joined by code while the roster already held a record under
   * the same name. The code cannot know who someone is, so this is the cost of
   * letting them in without staff creating the record first.
   */
  async listDuplicates(actorUserId: string) {
    const schoolId = await this.requireActorSchool(actorUserId);

    let data: {
      joined_id: string;
      existing_id: string;
      full_name: string | null;
    }[];
    try {
      data = await this.prisma.$queryRaw`
        SELECT joined_id, existing_id, full_name
        FROM public.student_duplicate_candidates(${schoolId}::uuid)`;
    } catch (error) {
      if (pgCode(error) === MISSING_FUNCTION) {
        this.logger.error(
          `student_duplicate_candidates is missing from the database. Apply the pending migrations.`,
        );
        return [];
      }
      this.logger.error(
        `Failed to list duplicates: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to load possible duplicates');
    }

    return data.map((row) => ({
      joinedId: row.joined_id,
      existingId: row.existing_id,
      name: row.full_name,
    }));
  }

  /**
   * Adopt the roster record: move the login onto the record holding the
   * history and drop the empty one created at join time.
   */
  async mergeDuplicate(
    actorUserId: string,
    joinedId: string,
    existingId: string,
  ): Promise<{ studentId: string }> {
    const schoolId = await this.requireActorSchool(actorUserId);

    // Captured before the merge: the row disappears, and the account whose
    // caches need dropping is the one attached to it.
    const joined = await this.prisma.student
      .findUnique({
        where: { id: joinedId },
        select: { user_profile_id: true },
      })
      .catch(() => null);

    let rows: { student_id: string | null }[];
    try {
      // The merge and its erasure-log entry commit together. Replaying it
      // moves the login across and drops the join-time record again.
      const loginId = joined?.user_profile_id ?? null;
      rows = await this.prisma.$transaction(async (tx) => {
        const merged = await tx.$queryRaw<{ student_id: string | null }[]>`
          SELECT student_id
          FROM public.merge_student_records(
            ${actorUserId}::uuid,
            ${joinedId}::uuid,
            ${existingId}::uuid
          )`;
        await this.erasure.record(tx, {
          kind: 'student',
          subjectTable: 'student.student',
          subjectIds: [joinedId],
          schoolId,
          actor: actorUserId,
          reason: 'merge',
          replay: plan.of(
            plan.update('student.student', { id: [joinedId] }, { user_profile_id: null }),
            ...(loginId
              ? [
                  plan.update(
                    'student.student',
                    { id: [existingId], user_profile_id: null },
                    { user_profile_id: loginId },
                  ),
                ]
              : []),
            plan.del('student.student', { id: [joinedId] }),
          ),
        });
        return merged;
      });
    } catch (error) {
      const detail = raisedMessage(error);

      if (detail.includes('joined_record_has_data')) {
        throw new BadRequestException(
          'That record already has results recorded against it, so it is not a duplicate',
        );
      }
      if (detail.includes('existing_record_already_claimed')) {
        throw new ConflictException(
          'The record you are merging into already has an account',
        );
      }
      if (detail.includes('student_other_school')) {
        throw new NotFoundException('Student not found');
      }
      if (detail.includes('student_not_found')) {
        throw new NotFoundException('Student not found');
      }

      this.logger.error(
        `Merge failed for ${joinedId}: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to merge student records');
    }

    const row = rows[0];

    if (joined?.user_profile_id) {
      await this.finalise(joined.user_profile_id, schoolId);
    } else {
      await this.cache.delete(`students:${schoolId}`);
    }

    this.logger.log(
      `Merged student ${joinedId} into ${existingId} for school ${schoolId}`,
    );

    return { studentId: row?.student_id ?? existingId };
  }
}
