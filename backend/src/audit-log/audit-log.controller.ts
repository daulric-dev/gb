import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
  QueryMethod,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { userSchoolId } from '@/common/user-school';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogDto } from './audit-log.dto';
import { PrismaService } from '@/prisma/prisma.service';

type Req = { user: { id: string } };

@ApiTags('Audit log')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller('schools')
export class SchoolAuditLogController {
  constructor(
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission('audit-log', 'read')
  @QueryMethod('current/audit-log')
  async list(@Req() req: Req, @Body() dto: ListAuditLogDto) {
    const schoolId = await userSchoolId(this.prisma, req.user.id);
    if (!schoolId)
      throw new ForbiddenException('You are not assigned to a school');
    return this.auditLog.list({
      schoolId,
      limit: dto.limit,
      before: dto.before,
    });
  }
}

@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation')
export class OrganisationAuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @QueryMethod('audit-log')
  list(@Body() dto: ListAuditLogDto) {
    return this.auditLog.list({ limit: dto.limit, before: dto.before });
  }

  /** Changes data on the strength of an old entry: confirm it's you first. */
  @Post('audit-log/:id/revert')
  @RequireStepUp()
  revert(@Req() req: Req, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.auditLog.revert(id, { id: req.user.id });
  }
}
