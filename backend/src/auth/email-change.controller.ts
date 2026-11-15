import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from './auth.guard';
import { RequireStepUp } from './step-up.guard';
import { EmailChangeService } from './email-change.service';
import { ConfirmEmailChangeDto, RequestEmailChangeDto } from './dto/email-change.dto';

interface AuthedRequest {
  user: { id: string; sessionId?: string };
}

/**
 * Change the address the caller signs in with: ask (after "Confirm it's
 * you"), then enter the code mailed to the new address. See
 * EmailChangeService.
 */
@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth/email-change')
@UseGuards(AuthGuard)
export class EmailChangeController {
  constructor(private readonly changes: EmailChangeService) {}

  /** The pending change, or null. */
  @Get()
  async pending(@Req() req: AuthedRequest) {
    return { pending: await this.changes.pending(req.user.id) };
  }

  /** Mail a code to the new address. Needs a recent step-up. */
  @Post()
  @RequireStepUp()
  @Throttle({ route: { limit: 5, ttl: 60 * 60 * 1000 } })
  request(@Req() req: AuthedRequest, @Body() dto: RequestEmailChangeDto) {
    return this.changes.request(req.user.id, dto.email);
  }

  /** Enter the code: the address changes and other devices are signed out. */
  @Post('confirm')
  @HttpCode(200)
  @Throttle({ route: { limit: 10, ttl: 15 * 60 * 1000 } })
  confirm(@Req() req: AuthedRequest, @Body() dto: ConfirmEmailChangeDto) {
    return this.changes.confirm(req.user.id, req.user.sessionId, dto.code);
  }

  @Delete()
  @HttpCode(204)
  async cancel(@Req() req: AuthedRequest) {
    await this.changes.cancel(req.user.id);
  }
}
