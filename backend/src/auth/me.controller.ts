import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { ActiveSchoolService } from './active-school.service';
import { SetActiveSchoolDto } from './dto/set-active-school.dto';
import { VersioningService } from '@/versioning/versioning.service';

/**
 * The caller's schools and their active school. Signed in only: the routes
 * decide access themselves (memberships, organisation admin).
 */
@ApiTags('Auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly activeSchool: ActiveSchoolService,
    private readonly versioning: VersioningService,
  ) {}

  /** Schools the caller can switch between (see ActiveSchoolService.list). */
  @Get('schools')
  async schools(@Req() req: any) {
    return this.activeSchool.list(req.user.id as string);
  }

  /** Switch the active school; returns the refreshed profile. */
  @Put('active-school')
  async setActiveSchool(@Req() req: any, @Body() dto: SetActiveSchoolDto) {
    const raw = await this.activeSchool.switch(req.user.id as string, dto.schoolId);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }
}
