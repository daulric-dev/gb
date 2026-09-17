import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { VersioningService } from '@/versioning/versioning.service';
import { GradeService } from './grade.service';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { BulkGradeDto } from './dto/bulk-grade.dto';
import { ExcludeDto } from './dto/exclude.dto';

@ApiTags('Grades')
@ApiBearerAuth()
@Controller('grades')
@UseGuards(AuthGuard, PermissionGuard)
export class GradeController {
  constructor(
    private readonly gradeService: GradeService,
    private readonly versioning: VersioningService,
  ) {}

  @RequirePermission('grade', 'read')
  @Get()
  async findByAssessment(
    @Query('assessmentId') assessmentId: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.gradeService.findByAssessment(
      assessmentId,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'grade.byAssessment')(raw);
  }

  @RequirePermission('grade', 'read')
  @Get('by-term')
  async findByTermAndSubject(
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.gradeService.findByTermAndSubject(
      termId,
      subjectId,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'grade.byTermSubject')(raw);
  }

  @RequirePermission('grade', 'create')
  @Post()
  async create(
    @Body() dto: CreateGradeDto,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.gradeService.create(req.user.id, dto, req, reply);
    return this.versioning.resolve(req, 'grade.created')(raw);
  }

  @RequirePermission('grade', 'create')
  @Post('bulk')
  async bulkCreate(
    @Body() dto: BulkGradeDto,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.gradeService.bulkCreate(
      req.user.id,
      dto,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'grade.bulkGraded')(raw);
  }

  @RequirePermission('grade', 'update')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGradeDto,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.gradeService.update(
      id,
      req.user.id,
      dto,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'grade.updated')(raw);
  }

  @RequirePermission('grade', 'update')
  @Patch(':id/exclude')
  async exclude(
    @Param('id') id: string,
    @Body() dto: ExcludeDto,
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.gradeService.exclude(
      id,
      req.user.id,
      dto,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'grade.excluded')(raw);
  }
}
