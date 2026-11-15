import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { NotificationSettingsService } from './notification-settings.service';
import {
  UpdateNotificationPreferencesDto,
  UpdatePushContentDto,
} from './dto/notification-settings.dto';

interface AuthedRequest {
  user: { id: string };
}

/** The caller's own notification preferences (any signed-in account). */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications/preferences')
@UseGuards(AuthGuard)
export class NotificationPreferencesController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get()
  get(@Req() req: AuthedRequest) {
    return this.settings.preferences(req.user.id);
  }

  @Put()
  update(@Req() req: AuthedRequest, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.settings.updatePreferences(req.user.id, dto);
  }
}

/** The active school's push-content setting (school:update). */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications/push-content')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolPushContentController {
  constructor(
    private readonly settings: NotificationSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  private async school(userId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
    return schoolId;
  }

  @RequirePermission('school', 'update')
  @Get()
  async get(@Req() req: AuthedRequest) {
    return this.settings.schoolPushContent(await this.school(req.user.id));
  }

  @RequirePermission('school', 'update')
  @Put()
  async update(@Req() req: AuthedRequest, @Body() dto: UpdatePushContentDto) {
    return this.settings.setSchoolPushContent(
      await this.school(req.user.id),
      dto.pushContent,
      req.user.id,
    );
  }
}

/** The organisation's push-content default (organisation admins). */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications/organisation/push-content')
@UseGuards(AuthGuard, OrganisationAdminGuard)
export class OrganisationPushContentController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get()
  get() {
    return this.settings.organisationPushContent();
  }

  @Put()
  update(@Req() req: AuthedRequest, @Body() dto: UpdatePushContentDto) {
    return this.settings.setOrganisationPushContent(dto.pushContent, req.user.id);
  }
}
