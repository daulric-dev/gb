import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  QueryMethod,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SchoolService } from './school.service';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { VersioningService } from '@/versioning/versioning.service';
import { CreateJoinRequestDto } from './dto/create-join-request.dto';
import { ApproveJoinRequestDto } from './dto/approve-join-request.dto';
import { UpdateUploadLimitDto } from './dto/update-upload-limit.dto';
import { UploadLimitService } from '@/file-manager/upload-limit.service';
import { CreateResumableUploadDto } from '@/images/dto/create-resumable-upload.dto';
import { CompleteUploadDto } from '@/images/dto/complete-upload.dto';
import { SchoolLogoService } from './school-logo.service';
import { userSchoolId } from '@/common/user-school';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { UpdateFeaturesDto } from '@/features/feature.dto';
import { SchoolSsoService } from '@/sso/school-sso.service';
import { UpdateSchoolSsoProviderDto } from '@/sso/school-sso.dto';
import { SsoAuditService } from '@/sso/sso-audit.service';
import { ListSsoAuditQueryDto } from '@/sso/sso-audit.dto';
import { RequireStepUp } from '@/auth/step-up.guard';

@ApiTags('Schools')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller('schools')
export class SchoolController {
  constructor(
    private readonly schoolService: SchoolService,
    private readonly versioning: VersioningService,
    private readonly uploadLimits: UploadLimitService,
    private readonly prisma: PrismaService,
    private readonly logos: SchoolLogoService,
    private readonly features: FeatureService,
    private readonly schoolSso: SchoolSsoService,
    private readonly ssoAudit: SsoAuditService,
  ) {}

  @Get()
  async findAll(@Req() req: any) {
    const raw = await this.schoolService.findAll();
    return this.versioning.resolve(req, 'school.list')(raw);
  }

  @Get('my-pending-request')
  async getMyPendingRequest(@Req() req: any) {
    const userId: string = req.user.id;
    return this.schoolService.getMyPendingRequest(userId);
  }

  // The only school route a catalog permission can guard: every other route
  // here is self-service onboarding (no school context to resolve yet) or
  // staff management behind AdminGuard.
  @RequirePermission('school', 'read')
  @Get('members')
  async getMembers(@Req() req: any) {
    const userId: string = req.user.id;
    return this.schoolService.getMembers(userId);
  }

  /**
   * The active school's upload limit, so clients can refuse an oversized file
   * before asking for a ticket. Any signed-in member (students upload too).
   */
  @Get('current/upload-limit')
  async getUploadLimit(@Req() req: any) {
    const userId: string = req.user.id;
    const schoolId = await this.activeSchool(userId);
    const raw = await this.uploadLimits.forSchool(schoolId);
    return this.versioning.resolve(req, 'school.uploadLimit')(raw);
  }

  /** Set the active school's upload limit; null returns it to the default. */
  @RequirePermission('school', 'update')
  @Patch('current/upload-limit')
  async updateUploadLimit(@Req() req: any, @Body() dto: UpdateUploadLimitDto) {
    const userId: string = req.user.id;
    const schoolId = await this.activeSchool(userId);
    const raw = await this.uploadLimits.setForSchool(
      schoolId,
      dto.maxUploadMb,
      userId,
    );
    return this.versioning.resolve(req, 'school.uploadLimit')(raw);
  }

  /**
   * Platform features for the active school: what the organisation allows,
   * what the school switched off, and what it gets.
   */
  @RequirePermission('school', 'update')
  @Get('current/features')
  async getFeatures(@Req() req: any) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.features.schoolFeatures(schoolId);
  }

  /** Switch features off for the school, or back on where allowed. */
  @RequirePermission('school', 'update')
  @Patch('current/features')
  async updateFeatures(@Req() req: any, @Body() dto: UpdateFeaturesDto) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.features.updateSchoolFeatures(
      schoolId,
      dto.features,
      req.user.id as string,
    );
  }

  /**
   * The active school's own sign-in apps (Google, Microsoft) and our SAML
   * service provider details. Secrets are never returned.
   */
  @RequirePermission('school', 'update')
  @Get('current/sso/providers')
  async getSsoProviders(@Req() req: any) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.schoolSso.list(schoolId, req as FastifyRequest);
  }

  /**
   * Save one of the active school's sign-in apps. Needs a recent step-up
   * confirmation; logged to the SSO audit log.
   */
  @RequirePermission('school', 'update')
  @RequireStepUp()
  @Put('current/sso/providers/:key')
  async updateSsoProvider(
    @Req() req: any,
    @Param('key') key: string,
    @Body() dto: UpdateSchoolSsoProviderDto,
  ) {
    const userId = req.user.id as string;
    const schoolId = await this.activeSchool(userId);
    return this.schoolSso.update(
      schoolId,
      key,
      dto,
      { id: userId, via: 'school_admin' },
      req as FastifyRequest,
    );
  }

  /**
   * The active school's single sign-on activity, newest first: `limit`
   * (default 50, at most 200) and `before` (the id of the last entry shown).
   */
  @RequirePermission('school', 'update')
  @UseGuards(AdminGuard)
  @QueryMethod('current/sso/audit')
  async getSsoAudit(@Req() req: any, @Body() dto: ListSsoAuditQueryDto) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.ssoAudit.list(schoolId, {
      limit: dto.limit,
      before: dto.before,
    });
  }

  /**
   * A presigned PUT for a new school logo (JPEG, PNG or WebP, at most 2 MB).
   * Members read the logo from their profile (`school.logo_url`).
   */
  @RequirePermission('school', 'update')
  @Post('current/logo/upload-ticket')
  async logoTicket(@Req() req: any, @Body() dto: CreateResumableUploadDto) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.logos.createTicket(schoolId, dto.contentType, dto.totalSize);
  }

  /** Verify the uploaded logo and set it; returns `{ logoUrl }`. */
  @RequirePermission('school', 'update')
  @Post('current/logo/complete')
  @HttpCode(200)
  async logoComplete(@Req() req: any, @Body() dto: CompleteUploadDto) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.logos.complete(schoolId, dto.path, req.user.id as string);
  }

  /** Remove the logo; clients fall back to the app mark. */
  @RequirePermission('school', 'update')
  @Delete('current/logo')
  async logoRemove(@Req() req: any) {
    const schoolId = await this.activeSchool(req.user.id as string);
    return this.logos.remove(schoolId, req.user.id as string);
  }

  @Post('leave')
  async leaveSchool(@Req() req: any) {
    const userId: string = req.user.id;
    return this.schoolService.leaveSchool(userId);
  }

  @Delete('members/:membershipId')
  @UseGuards(AdminGuard)
  async removeMember(
    @Req() req: any,
    @Param('membershipId') membershipId: string,
  ) {
    const userId: string = req.user.id;
    return this.schoolService.removeMember(userId, membershipId);
  }

  /** Sign a staff member of your school out of every device. */
  @Post('members/:membershipId/sessions/revoke')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async revokeMemberSessions(
    @Req() req: any,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
  ) {
    const userId: string = req.user.id;
    return this.schoolService.revokeMemberSessions(userId, membershipId);
  }

  // Must be defined before /:schoolId to avoid route conflicts
  @Get('join-requests')
  @UseGuards(AdminGuard)
  async getPendingRequests(@Req() req: any) {
    const userId: string = req.user.id;
    return this.schoolService.getPendingRequests(userId);
  }

  @Patch('join-requests/:requestId/approve')
  @UseGuards(AdminGuard)
  async approveRequest(
    @Req() req: any,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveJoinRequestDto,
  ) {
    const userId: string = req.user.id;
    return this.schoolService.approveRequest(
      userId,
      requestId,
      dto.role,
      dto.customRoleIds,
    );
  }

  @Patch('join-requests/:requestId/reject')
  @UseGuards(AdminGuard)
  async rejectRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const userId: string = req.user.id;
    return this.schoolService.rejectRequest(userId, requestId);
  }

  @Post(':schoolId/join-requests')
  async createJoinRequest(
    @Req() req: any,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateJoinRequestDto,
  ) {
    const userId: string = req.user.id;
    return this.schoolService.createJoinRequest(userId, schoolId, dto.message);
  }

  private async activeSchool(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return schoolId;
  }
}
