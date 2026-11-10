import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { userSchoolId } from '@/common/user-school';
import { ParentLinkService } from './parent-link.service';
import { CreateLinkCodeDto, InviteParentDto, UpdateParentSettingsDto } from './dto/parent.dto';
import { mergeParentSettings, parseParentSettings } from './parent-settings';

interface StaffRequest {
  user: { id: string };
}

/**
 * Staff side of parent links, on the student's page. Reading needs
 * `student:read`, changing needs `student:update`; the student must be in
 * the caller's active school (404 otherwise) and the school must have
 * `parent_portal` on.
 */
@ApiTags('Parent Portal')
@ApiBearerAuth()
@Controller('students/:studentId/parents')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('parent_portal')
export class StudentParentsController {
  constructor(private readonly links: ParentLinkService) {}

  @RequirePermission('student', 'read')
  @Get()
  list(@Req() req: StaffRequest, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.links.listForStudent(req.user.id, studentId);
  }

  @RequirePermission('student', 'update')
  @Post('invites')
  invite(
    @Req() req: StaffRequest,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: InviteParentDto,
  ) {
    return this.links.invite(req.user.id, studentId, dto);
  }

  @RequirePermission('student', 'update')
  @Post('link-codes')
  linkCode(
    @Req() req: StaffRequest,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CreateLinkCodeDto,
  ) {
    return this.links.createLinkCode(req.user.id, studentId, dto);
  }

  @RequirePermission('student', 'update')
  @Delete('invites/:inviteId')
  revokeInvite(
    @Req() req: StaffRequest,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.links.revokeInvite(req.user.id, studentId, inviteId);
  }

  @RequirePermission('student', 'update')
  @Delete(':linkId')
  remove(
    @Req() req: StaffRequest,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.links.removeLink(req.user.id, studentId, linkId);
  }
}

/**
 * What the active school shows parents. Not feature-gated, so a school can
 * set it up before switching the portal on.
 */
@ApiTags('Parent Portal')
@ApiBearerAuth()
@Controller('schools/current/parent-settings')
@UseGuards(AuthGuard, PermissionGuard)
export class ParentSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async school(userId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
    return schoolId;
  }

  @RequirePermission('school', 'update')
  @Get()
  async get(@Req() req: StaffRequest) {
    const schoolId = await this.school(req.user.id);
    const row = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { parent_settings: true },
    });
    return parseParentSettings(row?.parent_settings);
  }

  @RequirePermission('school', 'update')
  @Patch()
  async update(@Req() req: StaffRequest, @Body() dto: UpdateParentSettingsDto) {
    const schoolId = await this.school(req.user.id);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.school.findUnique({
        where: { id: schoolId },
        select: { parent_settings: true },
      });
      const before = parseParentSettings(row?.parent_settings);
      const merged = mergeParentSettings(before, dto.settings);
      if ('error' in merged) throw new BadRequestException(merged.error);
      await tx.school.update({
        where: { id: schoolId },
        data: { parent_settings: { ...merged.settings } },
      });
      await this.auditLog.record(tx, schoolId, { id: req.user.id }, {
        entity: 'school',
        entityId: schoolId,
        action: 'update',
        changes: auditChanges(
          { parent_settings: before },
          { parent_settings: merged.settings },
        ),
      });
      return merged.settings;
    });
  }
}
