import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

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
        this.logger.error(`OTP verification failed for ${email}: ${error?.message}`);
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
          this.logger.error(`Failed to create user_profile for ${userId}: ${insertError.message}`);
        }
        profile = newProfile;
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

      return profile;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`Unexpected error fetching profile: ${err}`);
      throw new NotFoundException('User profile not found');
    }
  }

  async onboard(userId: string, dto: { firstName: string; lastName: string; schoolId: string }) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('first_name, school_id')
      .eq('id', userId)
      .single();

    if (profile?.first_name && profile?.school_id) {
      throw new BadRequestException('User has already been onboarded');
    }

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
      this.logger.error(`Failed to onboard user ${userId}: ${error?.message}`);
      throw new BadRequestException('Failed to complete onboarding');
    }

    return data;
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