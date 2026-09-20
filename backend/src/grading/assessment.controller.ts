import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { VersioningService } from '@/versioning/versioning.service';
import { AssessmentService } from './assessment.service';

/**
 * Read-only view of the gradebook's assessments.
 *
 * Assessments are no longer authored directly: publishing a quiz or an
 * assignment from Work creates the assessment behind it, which keeps the work
 * students see and the row the calculation engine reads from drifting apart.
 * Writing here would let the two diverge again, so only reads remain - the
 * activity endpoints own the lifecycle, including exclusion.
 */
@ApiTags('Assessments')
@ApiBearerAuth()
@Controller('assessments')
@UseGuards(AuthGuard, PermissionGuard)
export class AssessmentController {
  constructor(
    private readonly assessmentService: AssessmentService,
    private readonly versioning: VersioningService,
  ) {}

  @RequirePermission('assessment', 'read')
  @Get()
  async findByTermAndSubject(
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.assessmentService.findByTermAndSubject(
      termId,
      subjectId,
      req,
      reply,
    );
    return this.versioning.resolve(req, 'assessment.list')(raw);
  }

  @RequirePermission('assessment', 'read')
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const raw = await this.assessmentService.findOne(id, req, reply);
    return this.versioning.resolve(req, 'assessment.detail')(raw);
  }
}
