import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { PrivacyService } from './privacy.service';
import { UpdatePrivacySettingsDto } from './privacy.dto';

type Req = { user: { id: string } };

/** Public, read before sign-in: per IP and route, generous. */
export const NOTICE_THROTTLE = { route: { limit: 60, ttl: 60 * 1000 } };

/** The public privacy notice: anyone, signed in or not. */
@ApiTags('Privacy')
@Controller('privacy')
export class PrivacyNoticeController {
  constructor(private readonly privacy: PrivacyService) {}

  @Throttle(NOTICE_THROTTLE)
  @Get('notice')
  notice() {
    return this.privacy.notice();
  }
}

/** The organisation's privacy notice details. Organisation admins; audited. */
@ApiTags('Privacy')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation/privacy')
export class OrganisationPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get()
  get() {
    return this.privacy.get();
  }

  @Put()
  update(@Req() req: Req, @Body() dto: UpdatePrivacySettingsDto) {
    return this.privacy.update(dto, req.user.id);
  }
}
