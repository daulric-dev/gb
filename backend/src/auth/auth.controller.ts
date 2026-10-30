import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ImagesService } from '@/images/images.service';
import { SendOtpDto } from '@/auth/dto/send-otp.dto';
import { VerifyOtpDto } from '@/auth/dto/verify-otp.dto';
import { OnboardDto } from '@/auth/dto/onboard.dto';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import { ClaimStudentDto } from '@/auth/dto/claim-student.dto';
import { StudentMembershipService } from '@/student-account/student-membership.service';
import { UpdateProfileDto } from '@/auth/dto/update-profile.dto';
import { CreateResumableUploadDto } from '@/images/dto/create-resumable-upload.dto';
import { CompleteUploadDto } from '@/images/dto/complete-upload.dto';
import { SessionService } from '@/account/session.service';
import { VersioningService } from '@/versioning/versioning.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly imagesService: ImagesService,
    private readonly sessions: SessionService,
    private readonly versioning: VersioningService,
    private readonly membership: StudentMembershipService,
    private readonly emailDomains: EmailDomainService,
  ) {}

  @Post('otp/send')
  @Throttle({
    'auth-strict': { limit: 5, ttl: 60 * 60 * 1000 },
    // Per IP: a whole school can sit behind one NAT address.
    'auth-ip': { limit: 300, ttl: 60 * 60 * 1000 },
  })
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: any) {
    const message = await this.authService.sendOtp(dto.email, req.ip as string);
    return this.versioning.resolve(req, 'auth.message')(message);
  }

  /**
   * Dev-only: issue a sign-in code and return it instead of mailing it, for
   * local scripts. 404 unless NODE_ENV !== 'production' and
   * ALLOW_DEV_LOGIN=true.
   */
  @ApiExcludeEndpoint()
  @Post('dev/code')
  async devCode(@Body() dto: SendOtpDto) {
    return this.authService.devCode(dto.email);
  }

  @Post('otp/verify')
  @Throttle({
    'auth-strict': { limit: 10, ttl: 15 * 60 * 1000 },
    'auth-ip': { limit: 600, ttl: 15 * 60 * 1000 },
  })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { session, user, profile } = await this.authService.verifyOtp(
      dto.email,
      dto.token,
      req,
      res,
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
    const userId: string = req.user.id;
    const raw = await this.authService.getProfile(userId);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('onboard')
  async onboard(@Req() req: any, @Body() dto: OnboardDto) {
    const userId: string = req.user.id;
    let raw = await this.authService.onboard(userId, dto);

    // A school address puts the user straight into the school that verified
    // the domain. Skipped when they picked a school themselves, and harmless
    // when nothing matches.
    if (!raw?.school_id && !dto.schoolId) {
      const joined = await this.emailDomains.tryAutoJoin(
        userId,
        req.user.email as string,
      );
      if (joined?.status === 'joined') {
        raw = await this.authService.getProfile(userId);
      }
    }

    return this.versioning.resolve(req, 'auth.profile')(raw);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ 'claim-code': { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('join-school')
  async joinSchool(@Req() req: any, @Body() dto: ClaimStudentDto) {
    const userId: string = req.user.id;
    return this.membership.joinByCode(userId, dto.code);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('profile')
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId: string = req.user.id;
    const raw = await this.authService.updateProfile(userId, dto);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete('account')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  async deleteAccount(@Req() req: any) {
    const userId: string = req.user.id;
    const message = await this.authService.deleteAccount(userId);
    return this.versioning.resolve(req, 'auth.message')(message);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    await this.sessions.revoke(req, res);
    return this.versioning.resolve(req, 'auth.message')('Logged out');
  }

  // ── Signed-in devices ────────────────────────────────────────────────

  /** The caller's live sessions; the one making this request has `current: true`. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('sessions')
  async listSessions(@Req() req: SessionRequest) {
    return this.sessions.list(req.user.id, req.user.sessionId);
  }

  /** Sign out one of your sessions (404 if it is not yours). Your own = log out. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete('sessions/:id')
  async revokeSession(
    @Req() req: SessionRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { current } = await this.sessions.revokeOwn(
      req.user.id,
      id,
      req.user.sessionId,
    );
    if (current) this.sessions.clearCookie(res);
    return { revoked: 1, current };
  }

  /** Sign out every other device. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOtherSessions(@Req() req: SessionRequest) {
    const revoked = await this.sessions.revokeOthers(
      req.user.id,
      req.user.sessionId ?? '',
    );
    return { revoked };
  }

  /** Sign out everywhere, this device included. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('sessions/revoke-all')
  @HttpCode(200)
  async revokeAllSessions(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const revoked = await this.sessions.revokeAll(req.user.id, 'signed_out_all');
    this.sessions.clearCookie(res);
    return { revoked };
  }

  // ── Avatar ───────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('avatar')
  @ApiProduces('image/*')
  async getAvatar(@Req() req: any, @Res() res: FastifyReply) {
    const userId: string = req.user.id;
    const { body, contentType, size } =
      await this.imagesService.getImageFromUserProfile(userId);

    res
      .header('Content-Type', contentType)
      .header('Cache-Control', 'private, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff');
    if (size !== null) res.header('Content-Length', size);
    return res.send(body);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('avatar/resumable')
  async createResumableUpload(
    @Req() req: FastifyRequest,
    @Body() dto: CreateResumableUploadDto,
  ) {
    const userId: string = (req as any).user.id;
    const result = await this.imagesService.createResumableUpload(
      userId,
      dto.filename,
      dto.contentType,
      dto.totalSize,
    );
    return this.versioning.resolve(req, 'images.resumable')(result);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('avatar/complete')
  async completeResumableUpload(
    @Req() req: FastifyRequest,
    @Body() dto: CompleteUploadDto,
  ) {
    const userId: string = (req as any).user.id;
    const result = await this.imagesService.completeResumableUpload(
      userId,
      dto.path,
      requestOrigin(req),
    );
    return this.versioning.resolve(req, 'images.uploaded')(result);
  }
}

/** A guarded request: AuthGuard sets the user and the session making it. */
type SessionRequest = { user: { id: string; sessionId?: string } };

/** This API's origin as the caller reached it, for links back to it. */
function requestOrigin(req: FastifyRequest): string | undefined {
  const host = req.headers?.host;
  return host ? `${req.protocol}://${host}` : undefined;
}
