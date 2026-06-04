import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { OnboardDto } from './dto/onboard.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const PROFILE_TTL = 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async sendOtp(email: string) {
    try {
      const supabase = this.supabaseService.getServiceClient();

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (error) {
        this.logger.error(`Failed to send OTP to ${email}: ${error.message}`);
        throw new BadRequestException('Failed to send OTP');
      }

      return 'OTP sent to email';
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Unexpected error sending OTP: ${String(err)}`);
      throw new BadRequestException('Failed to send OTP');
    }
  }

  async verifyOtp(
    email: string,
    token: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      // Verify on the user client so the SSR adapter writes the auth-token
      // cookie via setAll synchronously inside this call.
      const userClient = this.supabaseService.createUserClient(
        req,
        reply,
        'public',
      );

      const { data, error } = await userClient.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error || !data.session) {
        this.logger.error(
          `OTP verification failed for ${email}: ${error?.message}`,
        );
        throw new UnauthorizedException('Invalid or expired OTP');
      }

      const userId = data.session.user.id;
      const userEmail = data.session.user.email;

      // Profile lookup uses the service client to bypass RLS for the
      // first-time profile insert.
      const supabase = this.supabaseService.getServiceClient();

      let { data: profile } = await supabase
        .from('user_profile')
        .select('*, school:school_id(*)')
        .eq('id', userId)
        .single();

      if (!profile) {
        this.logger.log(`Creating new user_profile for ${userId}`);
        const { data: newProfile, error: insertError } = await supabase
          .from('user_profile')
          .insert({ id: userId, email: userEmail })
          .select('*, school:school_id(*)')
          .single();

        if (insertError) {
          this.logger.error(
            `Failed to create user_profile for ${userId}: ${insertError.message}`,
          );
        }
        profile = newProfile;
      } else if (!profile.email && userEmail) {
        // Backfill email for existing profiles created before the column
        // existed; populated lazily on the user's next login.
        const { data: updatedProfile, error: updateError } = await supabase
          .from('user_profile')
          .update({ email: userEmail })
          .eq('id', userId)
          .select('*, school:school_id(*)')
          .single();

        if (updateError) {
          this.logger.error(
            `Failed to backfill email for user_profile ${userId}: ${updateError.message}`,
          );
        } else {
          profile = updatedProfile;
        }
      }

      if (profile) {
        await this.cache.set(`profile:${userId}`, profile, PROFILE_TTL);
      }

      return {
        session: data.session,
        user: data.session.user,
        profile,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected error verifying OTP: ${String(err)}`);
      throw new UnauthorizedException('Invalid or expired OTP');
    }
  }

  async getProfile(userId: string) {
    const cached = await this.cache.get(`profile:${userId}`);
    if (cached?.email) return cached;

    const supabase = this.supabaseService.getServiceClient();

    const { data: profile, error } = await supabase
      .from('user_profile')
      .select('*, school:school_id(*), school_management(role)')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      this.logger.error(`Profile not found for ${userId}: ${error?.message}`);
      throw new NotFoundException('User profile not found');
    }

    // Backfill email for existing profiles (e.g. users with an active session
    // who won't re-run verifyOtp). getProfile has no session, so the email is
    // sourced from the auth user via the admin API.
    if (!profile.email) {
      const { data: authData, error: adminError } =
        await supabase.auth.admin.getUserById(userId);
      const authEmail = authData?.user?.email;

      if (adminError || !authEmail) {
        this.logger.error(
          `Failed to backfill email for user_profile ${userId}: ${adminError?.message ?? 'no auth email'}`,
        );
      } else {
        const { error: updateError } = await supabase
          .from('user_profile')
          .update({ email: authEmail })
          .eq('id', userId);

        if (updateError) {
          this.logger.error(
            `Failed to persist backfilled email for user_profile ${userId}: ${updateError.message}`,
          );
        } else {
          profile.email = authEmail;
        }
      }
    }

    if (profile.school_management.length === 1) {
      profile.school_management = {
        role: profile.school_management[0].role,
      };
    }

    await this.cache.set(`profile:${userId}`, profile, PROFILE_TTL);
    return profile;
  }

  async onboard(userId: string, dto: OnboardDto) {
    const supabase = this.supabaseService.getServiceClient();

    if (process.env.DEDICATED_DEPLOYMENT === 'true') {
      const { data: school } = await supabase
        .from('school')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!school) {
        throw new BadRequestException(
          'No school found on this dedicated instance',
        );
      }

      // Preserve an existing membership role (e.g. the school creator's
      // 'admin', set by SchoolService.create) - the dedicated branch runs for
      // every onboard, including theirs. Brand-new members default to teacher.
      const { data: membership } = await supabase
        .from('school_management')
        .select('role')
        .eq('user_id', userId)
        .eq('school_id', school.id)
        .maybeSingle();

      const role = membership?.role ?? 'teacher';

      const { data, error } = await supabase
        .from('user_profile')
        .upsert({
          id: userId,
          first_name: dto.firstName,
          last_name: dto.lastName,
          school_id: school.id,
          role,
        })
        .select('*, school:school_id(*)')
        .single();

      if (error || !data) {
        this.logger.error(
          `Failed to onboard user ${userId}: ${error?.message}`,
        );
        throw new BadRequestException('Failed to complete onboarding');
      }

      // Canonical membership so the permission layer recognizes the user.
      // Without this, a dedicated-instance user has a school_id but no
      // school_management row, and PermissionGuard treats them as a non-member.
      if (!membership) {
        const { error: managementError } = await supabase
          .from('school_management')
          .insert({ user_id: userId, school_id: school.id, role });

        if (managementError) {
          this.logger.error(
            `Failed to create school_management for ${userId} at ${school.id}: ${managementError.message}`,
          );
        }
      }

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return data;
    }

    // Check if user already has a school_id (set when they created a school)
    const { data: existing } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (existing?.school_id) {
      // User created a school - just update name
      const { data, error } = await supabase
        .from('user_profile')
        .upsert({
          id: userId,
          first_name: dto.firstName,
          last_name: dto.lastName,
        })
        .select('*, school:school_id(*)')
        .single();

      if (error || !data) {
        this.logger.error(
          `Failed to onboard user ${userId}: ${error?.message}`,
        );
        throw new BadRequestException('Failed to complete onboarding');
      }

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return data;
    }

    if (dto.schoolId) {
      // Joining an existing school always goes through the join-request flow,
      // which an existing admin must approve. Admin rights are only ever
      // granted to the user who *creates* a school (see SchoolService.create);
      // we never auto-grant admin from a client-supplied schoolId, since that
      // let any user claim ownership of any school lacking an admin.
      //
      // Go through the join request flow.
      const { data, error } = await supabase
        .from('user_profile')
        .upsert({
          id: userId,
          first_name: dto.firstName,
          last_name: dto.lastName,
        })
        .select('*, school:school_id(*)')
        .single();

      if (error || !data) {
        this.logger.error(
          `Failed to onboard user ${userId}: ${error?.message}`,
        );
        throw new BadRequestException('Failed to complete onboarding');
      }

      const { data: joinRequest, error: reqError } = await supabase
        .from('school_join_request')
        .insert({ user_id: userId, school_id: dto.schoolId })
        .select('id, school_id, status')
        .single();

      if (reqError) {
        this.logger.error(
          `Failed to create join request for user ${userId}: ${reqError.message}`,
        );
        throw new BadRequestException('Failed to submit join request');
      }

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return { ...data, joinRequest };
    }

    // No school selected - just save name
    const { data, error } = await supabase
      .from('user_profile')
      .upsert({
        id: userId,
        first_name: dto.firstName,
        last_name: dto.lastName,
      })
      .select('*, school:school_id(*)')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to onboard user ${userId}: ${error?.message}`);
      throw new BadRequestException('Failed to complete onboarding');
    }

    await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
    return data;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const supabase = this.supabaseService.getServiceClient();

    const patch: Record<string, any> = {
      first_name: dto.firstName,
      last_name: dto.lastName,
    };

    const { data, error } = await supabase
      .from('user_profile')
      .update(patch)
      .eq('id', userId)
      .select('*, school:school_id(*)')
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to update profile for ${userId}: ${error?.message}`,
      );
      throw new BadRequestException('Failed to update profile');
    }

    await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
    return data;
  }

  async deleteAccount(userId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { error: profileError } = await supabase
      .from('user_profile')
      .delete()
      .eq('id', userId);

    if (profileError) {
      this.logger.error(
        `Failed to delete user_profile for ${userId}: ${profileError.message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) {
      this.logger.error(
        `Failed to delete auth user ${userId}: ${authError.message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    await this.cache.delete(`profile:${userId}`);
    this.logger.log(`Account deleted for user ${userId}`);
    return 'Account deleted successfully';
  }
}
