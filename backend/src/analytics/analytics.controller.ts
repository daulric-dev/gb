import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsScheduler } from './analytics.scheduler';
import {
  AnalyticsSettingsDto,
  CourseExportDto,
  SchoolExportDto,
  SchoolFilterDto,
} from './dto/analytics.dto';

function sendCsv(reply: FastifyReply, out: { csv: string; filename: string }) {
  void reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${out.filename}"`)
    .header('Cache-Control', 'private, no-store')
    .send(out.csv);
}

const filterOf = (q: SchoolFilterDto) => ({ termId: q.termId, academicYearId: q.academicYearId });

/**
 * School analytics (cached summaries) and the at-risk rules. Every school
 * read needs `analytics:read`; the rules are readable by any member and
 * changed with `school:update`.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly scheduler: AnalyticsScheduler,
  ) {}

  @Get('school')
  @RequirePermission('analytics', 'read')
  async school(@Req() req: any, @Query() q: SchoolFilterDto) {
    return this.analytics.school(req.user.id as string, filterOf(q));
  }

  @Get('school/at-risk')
  @RequirePermission('analytics', 'read')
  async atRisk(@Req() req: any, @Query() q: SchoolFilterDto) {
    return this.analytics.schoolAtRisk(req.user.id as string, filterOf(q));
  }

  @Get('school/export')
  @RequirePermission('analytics', 'read')
  @ApiProduces('text/csv')
  async export(@Req() req: any, @Query() q: SchoolExportDto, @Res() reply: FastifyReply) {
    sendCsv(reply, await this.analytics.schoolCsv(req.user.id as string, q.table ?? 'courses', filterOf(q)));
  }

  @Post('school/refresh')
  @HttpCode(202)
  @RequirePermission('analytics', 'read')
  async refresh(@Req() req: any) {
    const { schoolId } = await this.analytics.memberSchool(req.user.id as string);
    return this.scheduler.refreshNow(schoolId);
  }

  @Get('settings')
  async settings(@Req() req: any) {
    return this.analytics.settings(req.user.id as string);
  }

  @Put('settings')
  @RequirePermission('school', 'update')
  async updateSettings(@Req() req: any, @Body() body: AnalyticsSettingsDto) {
    return this.analytics.updateSettings(req.user.id as string, body);
  }
}

/** One course's analytics: its staff, or `analytics:read` in its school. */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('courses/:courseId/analytics')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('analytics')
export class CourseAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  async get(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.analytics.course(req.user.id as string, courseId);
  }

  @Get('export')
  @ApiProduces('text/csv')
  async export(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query() q: CourseExportDto,
    @Res() reply: FastifyReply,
  ) {
    sendCsv(reply, await this.analytics.courseCsv(req.user.id as string, courseId, q.table ?? 'activities'));
  }
}
