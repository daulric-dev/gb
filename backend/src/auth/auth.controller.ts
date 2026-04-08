import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { SendOtpDto } from '@/auth/dto/send-otp.dto';
import { VerifyOtpDto } from '@/auth/dto/verify-otp.dto';
import { RefreshTokenDto } from '@/auth/dto/refresh-token.dto';
import { OnboardDto } from '@/auth/dto/onboard.dto';
import { SupabaseService } from '@/supabase/supabase.service';
import * as transform from './transformer';

const LATEST_VERSION = 1;

const versionMap = {
  verifyOtp: { 1: transform.v1VerifyOtp },
  profile: { 1: transform.v1Profile },
  session: { 1: transform.v1Session },
  message: { 1: transform.v1Message },
};

function getVersion(req: any, map: Record<number, Function>): number {
  const v = Number(req.headers['x-api-version']) || LATEST_VERSION;
  return map[v] ? v : LATEST_VERSION;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Post('otp/send')
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: any) {
    const message = await this.authService.sendOtp(dto.email);
    return versionMap.message[getVersion(req, versionMap.message)](message);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: any) {
    const { session, user, profile } = await this.authService.verifyOtp(dto.email, dto.token);
    return versionMap.verifyOtp[getVersion(req, versionMap.verifyOtp)](session, user, profile);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const raw = await this.authService.getProfile(req.user.id);
    return versionMap.profile[getVersion(req, versionMap.profile)](raw);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    const session = await this.authService.refreshToken(dto.refresh_token);
    return versionMap.session[getVersion(req, versionMap.session)](session);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('onboard')
  async onboard(@Req() req: any, @Body() dto: OnboardDto) {
    const raw = await this.authService.onboard(req.user.id, dto);
    return versionMap.profile[getVersion(req, versionMap.profile)](raw);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    const supabase = this.supabaseService.getServiceClient();
    await supabase.auth.admin.signOut(req.user.access_token);
    return versionMap.message[getVersion(req, versionMap.message)]('Logged out');
  }
}