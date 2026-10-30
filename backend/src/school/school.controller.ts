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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolService } from './school.service';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { VersioningService } from '@/versioning/versioning.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { CreateJoinRequestDto } from './dto/create-join-request.dto';
import { ApproveJoinRequestDto } from './dto/approve-join-request.dto';
import { UpdateUploadLimitDto } from './dto/update-upload-limit.dto';
import { UploadLimitService } from '@/file-manager/upload-limit.service';
import { userSchoolId } from '@/common/user-school';
import { PrismaService } from '@/prisma/prisma.service';

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
    const raw = await this.uploadLimits.setForSchool(schoolId, dto.maxUploadMb);
    return this.versioning.resolve(req, 'school.uploadLimit')(raw);
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

  @Post()
  async create(@Req() req: any, @Body() dto: CreateSchoolDto) {
    const userId: string = req.user.id;
    const raw = await this.schoolService.create(dto, userId);
    return this.versioning.resolve(req, 'school.detail')(raw);
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
