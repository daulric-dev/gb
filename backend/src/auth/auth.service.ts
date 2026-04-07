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

      return { message: 'OTP sent to email' };
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

      const { data: profile, error: profileError } = await supabase
        .from('user_profile')
        .select('*, school:school_id(*)')
        .eq('id', data.session.user.id)
        .single();

      if (profileError) {
        this.logger.error(`Failed to fetch profile for ${data.session.user.id}: ${profileError.message}`);
      }

      return {
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          expires_at: data.session.expires_at,
        },
        user: {
          id: data.session.user.id,
          email: data.session.user.email,
          first_name: profile?.first_name ?? null,
          last_name: profile?.last_name ?? null,
          role: profile?.role ?? null,
          school: profile?.school ?? null,
        },
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

      return {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected error refreshing token: ${err}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}