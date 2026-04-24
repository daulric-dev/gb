import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { SendOtpDto } from '@/auth/dto/send-otp.dto';
import { VerifyOtpDto } from '@/auth/dto/verify-otp.dto';
import { RefreshTokenDto } from '@/auth/dto/refresh-token.dto';
import { OnboardDto } from '@/auth/dto/onboard.dto';
import { UpdateProfileDto } from '@/auth/dto/update-profile.dto';
import { SupabaseService } from '@/supabase/supabase.service';
import { VersioningService } from '@/versioning/versioning.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
    private readonly versioning: VersioningService,
  ) {}

  @Post('otp/send')
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: any) {
    const message = await this.authService.sendOtp(dto.email);
    return this.versioning.resolve(req, 'auth.message')(message);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: any) {
    const { session, user, profile } = await this.authService.verifyOtp(
      dto.email,
      dto.token,
    );
    return this.versioning.resolve(req, 'auth.verifyOtp')(
      session,
      user,
      profile,
    );
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const raw = await this.authService.getProfile(req.user.id);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    const session = await this.authService.refreshToken(dto.refresh_token);
    return this.versioning.resolve(req, 'auth.session')(session);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('onboard')
  async onboard(@Req() req: any, @Body() dto: OnboardDto) {
    const raw = await this.authService.onboard(req.user.id, dto);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('profile')
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const raw = await this.authService.updateProfile(req.user.id, dto);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete('account')
  async deleteAccount(@Req() req: any) {
    const message = await this.authService.deleteAccount(req.user.id);
    return this.versioning.resolve(req, 'auth.message')(message);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    const supabase = this.supabaseService.getServiceClient();
    await supabase.auth.admin.signOut(req.user.access_token);
    return this.versioning.resolve(req, 'auth.message')('Logged out');
  }
}
