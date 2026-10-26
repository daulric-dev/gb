import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { BillingEnabledGuard, PlatformAdminGuard } from '../access/billing.guards';
import { PlatformService } from './platform.service';
import { SessionService } from '@/account/session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CompDto, ExtendTrialDto, INVOICE_STATUSES } from '../dto/billing.dto';

type Req = { user: { id: string } };

/** GET /platform/me: any signed-in user may ask (billing on only). */
@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(BillingEnabledGuard, AuthGuard)
@Controller('platform')
export class PlatformMeController {
  constructor(private readonly platform: PlatformService) {}

  @Get('me')
  async me(@Req() req: Req) {
    return { isPlatformAdmin: await this.platform.isPlatformAdmin(req.user.id) };
  }
}

/** The operator dashboard. 404 for everyone but platform admins. */
@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(BillingEnabledGuard, AuthGuard, PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);

  constructor(
    private readonly platform: PlatformService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('schools')
  schools(@Query('search') search?: string, @Query('status') status?: string) {
    return this.platform.schools(search, status || undefined);
  }

  @Get('schools/:schoolId')
  school(@Param('schoolId', new ParseUUIDPipe()) schoolId: string) {
    return this.platform.school(schoolId);
  }

  @Post('schools/:schoolId/extend-trial')
  @HttpCode(200)
  extendTrial(
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() dto: ExtendTrialDto,
  ) {
    return this.platform.extendTrial(schoolId, dto.days);
  }

  @Post('schools/:schoolId/comp')
  @HttpCode(200)
  comp(@Param('schoolId', new ParseUUIDPipe()) schoolId: string, @Body() dto: CompDto) {
    return this.platform.comp(schoolId, new Date(dto.until), dto.note);
  }

  /** Sign any user out of every device (support: a compromised account). */
  @Post('users/:userId/sessions/revoke')
  @HttpCode(200)
  async revokeUserSessions(
    @Req() req: Req,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    const user = await this.prisma.app_user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const revoked = await this.sessions.revokeAll(userId, 'platform_admin');
    this.logger.log(
      `Platform admin ${req.user.id} signed user ${userId} out of ${revoked} session(s)`,
    );
    return { revoked };
  }

  @Get('invoices')
  invoices(@Query('status') status?: string) {
    return this.platform.listInvoices(
      status && INVOICE_STATUSES.includes(status) ? status : undefined,
    );
  }

}
