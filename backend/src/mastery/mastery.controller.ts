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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { RequireStepUp } from '@/auth/step-up.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { StudentGuard, type StudentRequest } from '@/student-portal/student.guard';
import { userSchoolId } from '@/common/user-school';
import { contentDisposition } from '@/grading/content-disposition';
import { PrismaService } from '@/prisma/prisma.service';
import { MasteryService } from './mastery.service';
import { OutcomeService } from './outcome.service';
import {
  AlignmentDto,
  ImportOutcomesDto,
  MasterySettingsDto,
  OutcomeDto,
  OutcomeListQueryDto,
  OutcomeSetDto,
  UpdateOutcomeDto,
  UpdateOutcomeSetDto,
} from './dto/mastery.dto';

/**
 * School-level mastery: the proficiency scale and outcome sets, in the
 * caller's active school. Reading needs `school:read` (teachers and members
 * hold it, so teachers can pick outcomes); changing needs `school:update`.
 */
@ApiTags('Mastery')
@ApiBearerAuth()
@Controller('mastery')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('mastery')
export class MasterySchoolController {
  constructor(
    private readonly mastery: MasteryService,
    private readonly outcomes: OutcomeService,
    private readonly prisma: PrismaService,
  ) {}

  private async school(req: any): Promise<string> {
    const id = await userSchoolId(this.prisma, req.user.id as string);
    if (!id) throw new BadRequestException('You are not assigned to a school');
    return id;
  }

  @RequirePermission('school', 'read')
  @Get('settings')
  async settings(@Req() req: any) {
    return this.mastery.settings(await this.school(req));
  }

  @RequirePermission('school', 'update')
  @Put('settings')
  async updateSettings(@Req() req: any, @Body() dto: MasterySettingsDto) {
    return this.mastery.updateSettings(req.user.id as string, await this.school(req), dto);
  }

  @RequirePermission('school', 'read')
  @Get('outcome-sets')
  async sets(@Req() req: any, @Query() q: OutcomeListQueryDto) {
    return this.outcomes.listSets(await this.school(req), q.includeArchived === 'true');
  }

  @RequirePermission('school', 'update')
  @Post('outcome-sets')
  async createSet(@Req() req: any, @Body() dto: OutcomeSetDto) {
    return this.outcomes.createSet(req.user.id as string, await this.school(req), dto);
  }

  @RequirePermission('school', 'update')
  @Post('outcome-sets/import')
  async importSet(@Req() req: any, @Body() dto: ImportOutcomesDto) {
    return this.outcomes.importCsv(req.user.id as string, await this.school(req), dto);
  }

  @RequirePermission('school', 'read')
  @Get('outcome-sets/:setId')
  async set(@Req() req: any, @Param('setId', ParseUUIDPipe) setId: string) {
    return this.outcomes.getSet(await this.school(req), setId);
  }

  @RequirePermission('school', 'update')
  @Patch('outcome-sets/:setId')
  async updateSet(@Req() req: any, @Param('setId', ParseUUIDPipe) setId: string, @Body() dto: UpdateOutcomeSetDto) {
    return this.outcomes.updateSet(req.user.id as string, await this.school(req), setId, dto);
  }

  @RequirePermission('school', 'update')
  @Delete('outcome-sets/:setId')
  @HttpCode(204)
  async removeSet(@Req() req: any, @Param('setId', ParseUUIDPipe) setId: string) {
    await this.outcomes.removeSet(req.user.id as string, await this.school(req), setId);
  }

  @RequirePermission('school', 'update')
  @Post('outcome-sets/:setId/outcomes')
  async createOutcome(@Req() req: any, @Param('setId', ParseUUIDPipe) setId: string, @Body() dto: OutcomeDto) {
    return this.outcomes.createSchoolOutcome(req.user.id as string, await this.school(req), setId, dto);
  }

  @RequirePermission('school', 'update')
  @Patch('outcome-sets/:setId/outcomes/:outcomeId')
  async updateOutcome(
    @Req() req: any,
    @Param('setId', ParseUUIDPipe) setId: string,
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
    @Body() dto: UpdateOutcomeDto,
  ) {
    return this.outcomes.updateSchoolOutcome(req.user.id as string, await this.school(req), setId, outcomeId, dto);
  }

  @RequirePermission('school', 'update')
  @Delete('outcome-sets/:setId/outcomes/:outcomeId')
  @HttpCode(204)
  async removeOutcome(
    @Req() req: any,
    @Param('setId', ParseUUIDPipe) setId: string,
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
  ) {
    await this.outcomes.removeSchoolOutcome(req.user.id as string, await this.school(req), setId, outcomeId);
  }
}

/**
 * A course's outcomes, alignments and mastery views. Access is the course
 * role (`CourseAccessService`): staff read, the teacher (or a course admin)
 * changes outcomes and alignments.
 */
@ApiTags('Mastery')
@ApiBearerAuth()
@Controller('courses/:courseId')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('mastery')
export class MasteryCourseController {
  constructor(
    private readonly mastery: MasteryService,
    private readonly outcomes: OutcomeService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('outcomes')
  list(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.outcomes.courseOutcomes(req.user.id as string, courseId);
  }

  @Post('outcomes')
  create(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string, @Body() dto: OutcomeDto) {
    return this.outcomes.createCourseOutcome(req.user.id as string, courseId, dto);
  }

  @Patch('outcomes/:outcomeId')
  update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
    @Body() dto: UpdateOutcomeDto,
  ) {
    return this.outcomes.updateCourseOutcome(req.user.id as string, courseId, outcomeId, dto);
  }

  @Delete('outcomes/:outcomeId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
  ) {
    await this.outcomes.removeCourseOutcome(req.user.id as string, courseId, outcomeId);
  }

  @Post('outcome-alignments')
  align(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string, @Body() dto: AlignmentDto) {
    return this.outcomes.align(req.user.id as string, courseId, dto);
  }

  @Delete('outcome-alignments/:alignmentId')
  @HttpCode(204)
  async unalign(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('alignmentId', ParseUUIDPipe) alignmentId: string,
  ) {
    await this.outcomes.unalign(req.user.id as string, courseId, alignmentId);
  }

  @Get('mastery')
  grid(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.mastery.grid(req.user.id as string, courseId);
  }

  /** Bulk export of personal data: step-up, and audited with its row count. */
  @Get('mastery/export')
  @ApiProduces('text/csv')
  @RequireStepUp()
  async export(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string, @Res() reply: FastifyReply) {
    const out = await this.mastery.exportCsv(req.user.id as string, courseId);
    await this.audit.recordExport(req.user.id as string, {
      courseId,
      entity: 'mastery',
      scope: 'course',
      csv: out.csv,
    });
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', contentDisposition('attachment', out.filename))
      .header('Cache-Control', 'private, no-store')
      .send(out.csv);
  }

  @Get('mastery/students/:studentId')
  student(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.mastery.studentDetail(req.user.id as string, courseId, studentId);
  }
}

/** The student's own outcomes. No route takes a student id. */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me')
@UseGuards(AuthGuard, StudentGuard, FeatureGuard)
@RequireFeature('mastery')
export class PortalMasteryController {
  constructor(private readonly mastery: MasteryService) {}

  @Get('outcomes')
  outcomes(@Req() req: StudentRequest) {
    return this.mastery.studentOutcomes(req.student!.studentId);
  }
}
