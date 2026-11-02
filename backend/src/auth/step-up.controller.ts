import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from './auth.guard';
import { StepUpService, type StepUpUser } from './step-up.service';
import { VerifyStepUpDto } from './dto/step-up.dto';

type StepUpRequest = { user: StepUpUser; ip?: string };

/**
 * Step-up confirmation for the signed-in user (see StepUpService and
 * `@RequireStepUp()`): mail a code, then confirm it to let this session
 * change single sign-on settings for ten minutes.
 */
@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
@UseGuards(AuthGuard)
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Post('step-up/send')
  @HttpCode(200)
  @Throttle({
    'auth-strict': { limit: 5, ttl: 60 * 60 * 1000 },
    'auth-ip': { limit: 300, ttl: 60 * 60 * 1000 },
  })
  async send(@Req() req: StepUpRequest) {
    return this.stepUp.send(req.user, req.ip);
  }

  @Post('step-up/verify')
  @HttpCode(200)
  @Throttle({
    'auth-strict': { limit: 10, ttl: 15 * 60 * 1000 },
    'auth-ip': { limit: 600, ttl: 15 * 60 * 1000 },
  })
  async verify(@Req() req: StepUpRequest, @Body() dto: VerifyStepUpDto) {
    return this.stepUp.verify(req.user, dto.code, req.ip);
  }

  /** Dev-only (ALLOW_DEV_LOGIN, never production): the code, not mailed. */
  @ApiExcludeEndpoint()
  @Post('dev/step-up-code')
  @HttpCode(200)
  async devCode(@Req() req: StepUpRequest) {
    return this.stepUp.devCode(req.user);
  }
}
