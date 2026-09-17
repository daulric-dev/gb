import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { SupabaseService } from '@/supabase/supabase.service';
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
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
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
    const supabase = this.supabaseService.getServiceClient();

    const { data: actor } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', actorUserId)
      .maybeSingle();

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

    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.requireActorSchool(actorUserId);

    // One live code per school is a database constraint; clear the previous.
    const { error: clearError } = await supabase
      .schema('student')
      .from('school_join_code')
      .delete()
      .eq('school_id', schoolId)
      .is('revoked_at', null);

    if (clearError) {
      this.logger.error(
        `Failed to clear join codes for ${schoolId}: ${clearError.message}`,
      );
      throw new BadRequestException('Failed to issue join code');
    }

    const code = this.generateCode();
    const expiresAt = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error } = await supabase
      .schema('student')
      .from('school_join_code')
      .insert({
        school_id: schoolId,
        code_hash: this.hash(code),
        expires_at: expiresAt,
        created_by: actorUserId,
      });

    if (error) {
      this.logger.error(
        `Failed to issue join code for ${schoolId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to issue join code');
    }

    return { code: this.format(code), expiresAt };
  }

  /** Invalidate the school's live join code, if any. */
  async revokeCode(actorUserId: string): Promise<void> {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.requireActorSchool(actorUserId);

    const { error } = await supabase
      .schema('student')
      .from('school_join_code')
      .delete()
      .eq('school_id', schoolId)
      .is('revoked_at', null);

    if (error) {
      this.logger.error(
        `Failed to revoke join code for ${schoolId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to revoke join code');
    }
  }

  /** Whether a live code exists, and when it lapses. Never the code itself. */
  async getCodeStatus(actorUserId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.requireActorSchool(actorUserId);

    const { data } = await supabase
      .schema('student')
      .from('school_join_code')
      .select('expires_at, created_at')
      .eq('school_id', schoolId)
      .is('revoked_at', null)
      .maybeSingle();

    const expired = data ? new Date(data.expires_at) <= new Date() : false;

    return {
      activeCode:
        data && !expired
          ? { expiresAt: data.expires_at, issuedAt: data.created_at }
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

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase.rpc('redeem_school_join_code', {
      p_user_id: userId,
      p_code_hash: this.hash(normalized),
    });

    if (error) {
      const detail = `${error.code ?? ''} ${error.message ?? ''}`;

      if (detail.includes('already_in_a_school')) {
        throw new ConflictException('This account already belongs to a school');
      }
      if (detail.includes('profile_not_found')) {
        throw new BadRequestException('Complete your profile first');
      }
      if (detail.includes('invalid_join_code')) {
        throw new BadRequestException('Invalid or expired join code');
      }
      if (error.code === 'PGRST202') {
        this.logger.error(
          `redeem_school_join_code is missing from the database. Apply the pending migrations. Detail: ${error.message}`,
        );
        throw new BadRequestException(
          'Joining by code is unavailable: the database is missing redeem_school_join_code. Apply the pending migrations.',
        );
      }

      this.logger.error(`Join failed for user ${userId}: ${error.message}`);
      throw new BadRequestException('Failed to redeem join code');
    }

    const row = Array.isArray(data) ? data[0] : data;

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
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.requireActorSchool(actorUserId);

    const { data, error } = await supabase.rpc(
      'student_duplicate_candidates',
      { p_school_id: schoolId },
    );

    if (error) {
      if (error.code === 'PGRST202') {
        this.logger.error(
          `student_duplicate_candidates is missing from the database. Apply the pending migrations.`,
        );
        return [];
      }
      this.logger.error(`Failed to list duplicates: ${error.message}`);
      throw new BadRequestException('Failed to load possible duplicates');
    }

    return ((data ?? []) as any[]).map((row) => ({
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
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.requireActorSchool(actorUserId);

    // Captured before the merge: the row disappears, and the account whose
    // caches need dropping is the one attached to it.
    const { data: joined } = await supabase
      .schema('student')
      .from('student')
      .select('user_profile_id')
      .eq('id', joinedId)
      .maybeSingle();

    const { data, error } = await supabase.rpc('merge_student_records', {
      p_admin_id: actorUserId,
      p_joined_id: joinedId,
      p_existing_id: existingId,
    });

    if (error) {
      const detail = `${error.code ?? ''} ${error.message ?? ''}`;

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

      this.logger.error(`Merge failed for ${joinedId}: ${error.message}`);
      throw new BadRequestException('Failed to merge student records');
    }

    const row = Array.isArray(data) ? data[0] : data;

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
