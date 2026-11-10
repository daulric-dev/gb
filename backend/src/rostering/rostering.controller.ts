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
  QueryMethod,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp, stepUpRequired } from '@/auth/step-up.guard';
import { Throttle } from '@nestjs/throttler';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { RosteringFeatureGuard } from './rostering-feature.guard';
import { RosterSourceService } from './roster-source.service';
import { RosterRunService } from './roster-run.service';
import { TEMPLATES, templateCsv, type TemplateKind } from './roster-csv';
import {
  ApplyRunDto,
  CreateRosterSourceDto,
  ListChangesQueryDto,
  RosterUploadTicketDto,
  StartDryRunDto,
  UpdateRosterSourceDto,
} from './dto/rostering.dto';

type Req = { user: { id: string; sessionId?: string; elevatedUntil?: number | null } };
const uuid = new ParseUUIDPipe();

/**
 * Rostering sync, organisation admins only, behind the organisation-level
 * `rostering` feature (403 FEATURE_DISABLED while off). Changing a source's
 * endpoint or credentials, or deleting it, needs a step-up confirmation.
 */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard, RosteringFeatureGuard)
@Controller('organisation/rostering')
export class RosteringController {
  constructor(
    private readonly sources: RosterSourceService,
    private readonly runs: RosterRunService,
  ) {}

  @Get('templates/:kind')
  @ApiProduces('text/csv')
  template(@Param('kind') kind: string, @Res() res: FastifyReply) {
    const name = kind.replace(/\.csv$/, '');
    if (!(name in TEMPLATES)) throw new BadRequestException('Unknown template: students, staff, classes or enrolments');
    return res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="gradebook-${name}.csv"`)
      .send(templateCsv(name as TemplateKind));
  }

  @Get('sources')
  list() {
    return this.sources.list();
  }

  @RequireStepUp()
  @Post('sources')
  create(@Req() req: Req, @Body() dto: CreateRosterSourceDto) {
    return this.sources.create(dto, req.user.id);
  }

  @Get('sources/:id')
  get(@Param('id', uuid) id: string) {
    return this.sources.get(id);
  }

  @Patch('sources/:id')
  update(@Req() req: Req, @Param('id', uuid) id: string, @Body() dto: UpdateRosterSourceDto) {
    // Endpoint and credential changes need step-up (as StepUpGuard checks);
    // the org mapping, matching and schedule options do not.
    const connection =
      dto.baseUrl !== undefined || dto.tokenUrl !== undefined || dto.clientId !== undefined || !!dto.clientSecret;
    const until = req.user.elevatedUntil;
    if (connection && !(req.user.sessionId && typeof until === 'number' && until > Date.now())) {
      throw stepUpRequired();
    }
    return this.sources.update(id, dto, req.user.id);
  }

  @RequireStepUp()
  @Delete('sources/:id')
  @HttpCode(204)
  async remove(@Req() req: Req, @Param('id', uuid) id: string) {
    await this.sources.remove(id, req.user.id);
  }

  // Calls the source's saved endpoint (through the SSRF-guarded fetch);
  // rate-limited so it can't be used to probe hosts.
  @Throttle({ route: { limit: 10, ttl: 60 * 1000 } })
  @Post('sources/:id/test')
  @HttpCode(200)
  test(@Param('id', uuid) id: string) {
    return this.sources.testConnection(id);
  }

  @Post('sources/:id/uploads')
  upload(@Param('id', uuid) id: string, @Body() dto: RosterUploadTicketDto) {
    return this.sources.uploadTicket(id, dto);
  }

  @Post('sources/:id/runs')
  dryRun(@Req() req: Req, @Param('id', uuid) id: string, @Body() dto: StartDryRunDto) {
    return this.runs.startDryRun(id, dto.uploads, req.user.id);
  }

  @Get('sources/:id/runs')
  runList(@Param('id', uuid) id: string) {
    return this.runs.listRuns(id);
  }

  @Get('sources/:id/runs/:runId')
  run(@Param('id', uuid) id: string, @Param('runId', uuid) runId: string) {
    return this.runs.getRun(id, runId);
  }

  @QueryMethod('sources/:id/runs/:runId/changes')
  changes(@Param('id', uuid) id: string, @Param('runId', uuid) runId: string, @Body() dto: ListChangesQueryDto) {
    return this.runs.changes(id, runId, dto);
  }

  @Post('sources/:id/runs/:runId/apply')
  @HttpCode(200)
  async apply(
    @Req() req: Req,
    @Param('id', uuid) id: string,
    @Param('runId', uuid) runId: string,
    @Body() dto: ApplyRunDto,
  ) {
    await this.runs.requireRun(runId, id);
    return this.runs.apply(runId, { includeDisables: dto.includeDisables }, req.user.id);
  }

  @Post('sources/:id/runs/:runId/cancel')
  @HttpCode(200)
  async cancel(@Param('id', uuid) id: string, @Param('runId', uuid) runId: string) {
    await this.runs.requireRun(runId, id);
    return this.runs.cancel(runId);
  }

  @Get('sources/:id/runs/:runId/errors.csv')
  @ApiProduces('text/csv')
  async errors(@Param('id', uuid) id: string, @Param('runId', uuid) runId: string, @Res() res: FastifyReply) {
    const csv = await this.runs.errorsCsv(id, runId);
    return res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="rostering-errors-${runId.slice(0, 8)}.csv"`)
      .header('Cache-Control', 'private, no-store')
      .send(csv);
  }
}
