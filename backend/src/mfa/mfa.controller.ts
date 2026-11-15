import {
  Body,
  Controller,
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { MfaService, type MfaUser } from './mfa.service';
import { ConfirmMfaDto, DisableMfaDto, MfaPolicyDto, VerifyMfaDto } from './mfa.dto';

type UserRequest = { user: MfaUser };

/**
 * Authenticator-app two-step verification for the signed-in user, and the
 * sign-in code step (`verify`, no session yet). Changes need step-up.
 */
@ApiTags('Auth')
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  /**
   * Finish a sign-in that answered 403 `MFA_REQUIRED`: the token from that
   * answer plus a 6-digit code (or a recovery code). Sets the session like
   * `/auth/otp/verify`.
   */
  @Post('verify')
  @HttpCode(200)
  @Throttle({
    route: { limit: 10, ttl: 60_000 },
    'auth-ip': { limit: 600, ttl: 15 * 60 * 1000 },
  })
  verify(
    @Body() dto: VerifyMfaDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.mfa.verifyChallenge(req, res, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get()
  status(@Req() req: UserRequest) {
    return this.mfa.status(req.user);
  }

  /** A new secret and otpauth:// URI to scan; replaces the app once confirmed. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @RequireStepUp()
  @Post('enrol')
  @HttpCode(200)
  @Throttle({ route: { limit: 10, ttl: 60 * 60 * 1000 } })
  startEnrolment(@Req() req: UserRequest) {
    return this.mfa.startEnrolment(req.user);
  }

  /** Confirm with a code from the app: returns ten recovery codes, shown once. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('enrol/confirm')
  @HttpCode(200)
  @Throttle({ route: { limit: 10, ttl: 15 * 60 * 1000 } })
  confirmEnrolment(@Req() req: UserRequest, @Body() dto: ConfirmMfaDto) {
    return this.mfa.confirmEnrolment(req.user, dto.code);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @RequireStepUp()
  @Post('recovery-codes')
  @HttpCode(200)
  @Throttle({ route: { limit: 5, ttl: 60 * 60 * 1000 } })
  regenerate(@Req() req: UserRequest) {
    return this.mfa.regenerateRecoveryCodes(req.user);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @RequireStepUp()
  @Post('disable')
  @HttpCode(200)
  @Throttle({ route: { limit: 10, ttl: 15 * 60 * 1000 } })
  disable(@Req() req: UserRequest, @Body() dto: DisableMfaDto) {
    return this.mfa.disable(req.user, dto);
  }
}

/** The organisation's two-step policy and admin resets (organisation admins). */
@ApiTags('Organisation')
@ApiBearerAuth()
@Controller('organisation')
@UseGuards(AuthGuard, OrganisationAdminGuard)
export class MfaOrganisationController {
  constructor(private readonly mfa: MfaService) {}

  @Get('mfa-policy')
  policy() {
    return this.mfa.policy();
  }

  @RequireStepUp()
  @Patch('mfa-policy')
  setPolicy(@Req() req: UserRequest, @Body() dto: MfaPolicyDto) {
    return this.mfa.setPolicy(req.user.id, dto.requireMfaForAdmins);
  }

  /** Remove someone's authenticator app and recovery codes (lost phone). Emails them. */
  @RequireStepUp()
  @Post('users/:userId/mfa/reset')
  @HttpCode(200)
  @Throttle({ route: { limit: 20, ttl: 60 * 60 * 1000 } })
  reset(@Req() req: UserRequest, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.mfa.adminReset(req.user.id, userId);
  }
}
