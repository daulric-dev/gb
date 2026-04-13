import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { OnboardDto } from './dto/onboard.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const PROFILE_TTL = 300;

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
      this.logger.error(`Unexpected error sending OTP: ${err}`);
      throw new BadRequestException('Failed to send OTP');
    }
  }

  async verifyOtp(email: string, token: string) {
    try {
      const supabase = this.supabaseService.getServiceClient();

      const { data, error } = await supabase.auth.verifyOtp({
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
      this.logger.error(`Unexpected error verifying OTP: ${err}`);
      throw new UnauthorizedException('Invalid or expired OTP');
    }
  }

  async getProfile(userId: string) {
    try {
      const cached = await this.cache.get(`profile:${userId}`);
      if (cached) return cached;

      const supabase = this.supabaseService.getServiceClient();

      const { data: profile, error } = await supabase
        .from('user_profile')
        .select('*, school:school_id(*)')
        .eq('id', userId)
        .single();

      if (error || !profile) {
        this.logger.error(`Profile not found for ${userId}: ${error?.message}`);
        throw new NotFoundException('User profile not found');
      }

      await this.cache.set(`profile:${userId}`, profile, PROFILE_TTL);
      return profile;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`Unexpected error fetching profile: ${err}`);
      throw new NotFoundException('User profile not found');
    }
  }

  async onboard(userId: string, dto: OnboardDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('user_profile')
      .upsert({
        id: userId,
        first_name: dto.firstName,
        last_name: dto.lastName,
        school_id: dto.schoolId,
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

    const { data, error } = await supabase
      .from('user_profile')
      .update({
        first_name: dto.firstName,
        last_name: dto.lastName,
        school_id: dto.schoolId,
      })
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

  async refreshToken(refreshToken: string) {
    try {
      const supabase = this.supabaseService.getServiceClient();

      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (error || !data.session) {
        this.logger.error(`Token refresh failed: ${error?.message}`);
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      return data.session;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected error refreshing token: ${err}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
