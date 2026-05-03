import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolService } from './school.service';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { VersioningService } from '@/versioning/versioning.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { CreateJoinRequestDto } from './dto/create-join-request.dto';
import { ApproveJoinRequestDto } from './dto/approve-join-request.dto';

@ApiTags('Schools')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('schools')
export class SchoolController {
  constructor(
    private readonly schoolService: SchoolService,
    private readonly versioning: VersioningService,
  ) {}

  @Get()
  async findAll(@Req() req: any) {
    const raw = await this.schoolService.findAll();
    return this.versioning.resolve(req, 'school.list')(raw);
  }

  // Must be defined before /:schoolId to avoid route conflicts
  @Get('join-requests')
  @UseGuards(AdminGuard)
  async getPendingRequests(@Req() req: any) {
    return this.schoolService.getPendingRequests(req.user.id);
  }

  @Patch('join-requests/:requestId/approve')
  @UseGuards(AdminGuard)
  async approveRequest(
    @Req() req: any,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveJoinRequestDto,
  ) {
    return this.schoolService.approveRequest(req.user.id, requestId, dto.role);
  }

  @Patch('join-requests/:requestId/reject')
  @UseGuards(AdminGuard)
  async rejectRequest(
    @Req() req: any,
    @Param('requestId') requestId: string,
  ) {
    return this.schoolService.rejectRequest(req.user.id, requestId);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateSchoolDto) {
    const raw = await this.schoolService.create(dto, req.user.id);
    return this.versioning.resolve(req, 'school.detail')(raw);
  }

  @Post(':schoolId/join-requests')
  async createJoinRequest(
    @Req() req: any,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateJoinRequestDto,
  ) {
    return this.schoolService.createJoinRequest(
      req.user.id,
      schoolId,
      dto.message,
    );
  }
}
