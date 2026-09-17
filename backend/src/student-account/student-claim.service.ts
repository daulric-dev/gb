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

@Injectable()
export class StudentClaimService {
  private readonly logger = new Logger(StudentClaimService.name);
  private readonly pepper: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {
    const configured = process.env.STUDENT_CLAIM_CODE_PEPPER?.trim();

    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        // Fail closed. Without a secret pepper, anyone who reads the
        // student_claim_code table can brute-force a 59-bit code offline and
        // take over a student account.
        throw new Error(
          'STUDENT_CLAIM_CODE_PEPPER is required in production (student claim codes are stored as keyed hashes).',
        );
      }
      this.logger.warn(
        'No STUDENT_CLAIM_CODE_PEPPER set - student claim codes use a well-known dev pepper (dev only).',
      );
    }

    this.pepper = configured || DEV_PEPPER;
  }

  /** Strip formatting so "abcd-efgh-jkmn" and "ABCDEFGHJKMN" are one code. */
  private normalize(code: string): string {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Keyed hash, not a bare digest: the pepper is what makes a leaked table
   * useless. Deterministic so redemption is an indexed lookup rather than a
   * scan over every outstanding code.
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

  /**
   * Issue a claim code for a student, superseding any outstanding one.
   * Returns the plaintext exactly once - only its hash is stored, so a lost
   * code is reissued rather than recovered.
   */
  async issue(
    actorUserId: string,
    studentId: string,
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<{ code: string; expiresAt: string }> {
    if (!Number.isFinite(ttlDays) || ttlDays < 1 || ttlDays > MAX_TTL_DAYS) {
      throw new BadRequestException(
        `Expiry must be between 1 and ${MAX_TTL_DAYS} days`,
      );
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data: actor } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', actorUserId)
      .maybeSingle();

    if (!actor?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const { data: student } = await supabase
      .schema('student')
      .from('student')
      .select('id, school_id, user_profile_id')
      .eq('id', studentId)
      .maybeSingle();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Defence in depth: the route is permission-guarded, but that resolves the
    // caller's school, not this student's. Without this a staff member could
    // mint a code for a student at another school.
    if (student.school_id !== actor.school_id) {
      throw new NotFoundException('Student not found');
    }

    if (student.user_profile_id) {
      throw new ConflictException('This student already has an account');
    }

    // One outstanding code per student is a database constraint; clear the
    // previous one so reissuing supersedes rather than failing.
    const { error: clearError } = await supabase
      .schema('student')
      .from('student_claim_code')
      .delete()
      .eq('student_id', studentId)
      .is('redeemed_at', null);

    if (clearError) {
      this.logger.error(
        `Failed to clear existing claim codes for student ${studentId}: ${clearError.message}`,
      );
      throw new BadRequestException('Failed to issue claim code');
    }

    const code = this.generateCode();
    const expiresAt = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error } = await supabase
      .schema('student')
      .from('student_claim_code')
      .insert({
        school_id: actor.school_id,
        student_id: studentId,
        code_hash: this.hash(code),
        expires_at: expiresAt,
        created_by: actorUserId,
      });

    if (error) {
      this.logger.error(
        `Failed to issue claim code for student ${studentId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to issue claim code');
    }

    return { code: this.format(code), expiresAt };
  }

  /**
   * Whether this student has an account and whether a code is outstanding.
   * Never returns the code itself - only its hash is stored, so a lost code is
   * reissued rather than recovered.
   */
  async getStatus(actorUserId: string, studentId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: actor } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', actorUserId)
      .maybeSingle();

    if (!actor?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const { data: student } = await supabase
      .schema('student')
      .from('student')
      .select('id, school_id, user_profile_id')
      .eq('id', studentId)
      .maybeSingle();

    if (!student || student.school_id !== actor.school_id) {
      throw new NotFoundException('Student not found');
    }

    const { data: code } = await supabase
      .schema('student')
      .from('student_claim_code')
      .select('expires_at, created_at')
      .eq('student_id', studentId)
      .is('redeemed_at', null)
      .maybeSingle();

    const expired = code ? new Date(code.expires_at) <= new Date() : false;

    return {
      hasAccount: !!student.user_profile_id,
      outstandingCode: code && !expired
        ? { expiresAt: code.expires_at, issuedAt: code.created_at }
        : null,
      expiredCode: !!code && expired,
    };
  }

  /** Invalidate the outstanding code for a student, if any. */
  async revoke(actorUserId: string, studentId: string): Promise<void> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: actor } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', actorUserId)
      .maybeSingle();

    if (!actor?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const { error } = await supabase
      .schema('student')
      .from('student_claim_code')
      .delete()
      .eq('student_id', studentId)
      .eq('school_id', actor.school_id)
      .is('redeemed_at', null);

    if (error) {
      this.logger.error(
        `Failed to revoke claim code for student ${studentId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to revoke claim code');
    }
  }

  // ── School-wide join codes ────────────────────────────────────────────────
  // Issued per school rather than per student. A student redeems one when the
  // school has no record for them yet; redemption creates it.

  /** Issue (or reissue) the school's join code, superseding any live one. */
  async issueSchoolCode(
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
        `Failed to clear school join codes for ${schoolId}: ${clearError.message}`,
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
        `Failed to issue school join code for ${schoolId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to issue join code');
    }

    return { code: this.format(code), expiresAt };
  }

  /** Invalidate the school's live join code, if any. */
  async revokeSchoolCode(actorUserId: string): Promise<void> {
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
        `Failed to revoke school join code for ${schoolId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to revoke join code');
    }
  }

  /** Whether a live code exists, and when it lapses. Never the code itself. */
  async getSchoolCodeStatus(actorUserId: string) {
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
   * Redeem a school join code: creates the caller's student record and binds
   * their profile to the school. Unlike a claim code this is not consumed - it
   * stays valid for the next student until it expires or is revoked.
   */
  async redeemSchoolCode(
    userId: string,
    rawCode: string,
  ): Promise<{ studentId: string; schoolId: string }> {
    const normalized = this.normalize(rawCode);

    if (normalized.length !== CODE_LENGTH) {
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

      this.logger.error(
        `School join redemption failed for user ${userId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to redeem join code');
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row?.student_id || !row?.school_id) {
      throw new BadRequestException('Invalid or expired join code');
    }

    await this.cache.delete(`profile:${userId}`);
    await this.cache.delete(`student-context:${userId}`);

    this.logger.log(
      `User ${userId} joined school ${row.school_id} by code as student ${row.student_id}`,
    );

    return { studentId: row.student_id, schoolId: row.school_id };
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

  /**
   * Redeem a code: burns it, links the login to the student record, and marks
   * the profile as a student bound to that school. All three happen inside one
   * database transaction (see redeem_student_claim_code).
   */
  async redeem(
    userId: string,
    rawCode: string,
  ): Promise<{ studentId: string; schoolId: string }> {
    const normalized = this.normalize(rawCode);

    if (normalized.length !== CODE_LENGTH) {
      // Same error as a wrong code: the length of a valid code is not a hint
      // worth handing out.
      throw new BadRequestException('Invalid or expired claim code');
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('school_id, account_type')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) {
      throw new BadRequestException('Complete your profile first');
    }

    // Claiming is for accounts that have not landed anywhere yet. A staff
    // member with a school must not be able to convert themselves into a
    // student, and an already-linked student has nothing to claim.
    if (profile.school_id) {
      throw new ConflictException('This account already belongs to a school');
    }

    const { data, error } = await supabase.rpc('redeem_student_claim_code', {
      p_user_id: userId,
      p_code_hash: this.hash(normalized),
    });

    if (error) {
      const detail = `${error.code ?? ''} ${error.message ?? ''}`;

      if (detail.includes('student_already_claimed')) {
        throw new ConflictException('This student already has an account');
      }
      if (detail.includes('invalid_claim_code')) {
        throw new BadRequestException('Invalid or expired claim code');
      }

      this.logger.error(
        `Claim redemption failed for user ${userId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to redeem claim code');
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row?.student_id || !row?.school_id) {
      throw new BadRequestException('Invalid or expired claim code');
    }

    // Redemption sets school_id and account_type, but getProfile serves
    // `profile:<id>` for thirty days. Without this the client keeps seeing a
    // school-less profile and never routes to the portal.
    await this.cache.delete(`profile:${userId}`);
    await this.cache.delete(`student-context:${userId}`);

    this.logger.log(`User ${userId} claimed student ${row.student_id}`);

    return { studentId: row.student_id, schoolId: row.school_id };
  }
}
