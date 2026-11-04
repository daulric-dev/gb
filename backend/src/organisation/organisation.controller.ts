import {
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
import { AuthGuard } from '@/auth/auth.guard';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { OrganisationService } from './organisation.service';
import { FeatureService } from '@/features/feature.service';
import { UpdateFeaturesDto } from '@/features/feature.dto';
import { UploadLimitService } from '@/file-manager/upload-limit.service';
import { SchoolLogoService } from '@/school/school-logo.service';
import { UpdateUploadLimitDto } from '@/school/dto/update-upload-limit.dto';
import { CreateResumableUploadDto } from '@/images/dto/create-resumable-upload.dto';
import { CompleteUploadDto } from '@/images/dto/complete-upload.dto';
import { VersioningService } from '@/versioning/versioning.service';
import {
  AdminEmailDto,
  CreateOrganisationSchoolDto,
  ListOrganisationSchoolsQueryDto,
  SetupDto,
  UpdateOrganisationDto,
  UpdateOrganisationSchoolDto,
} from './dto/organisation.dto';

type Req = { user: { id: string } };

/** First-run setup: name the organisation and become its first admin. */
@ApiTags('Setup')
@Controller('setup')
export class SetupController {
  constructor(private readonly organisation: OrganisationService) {}

  /** Public: clients ask before sign-in whether to show the setup screen. */
  @Get('status')
  status() {
    return this.organisation.status();
  }

  /** Signed in: whether setup is pending and whether this user may run it. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('eligibility')
  eligibility(@Req() req: Req) {
    return this.organisation.eligibility(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post()
  setup(@Req() req: Req, @Body() dto: SetupDto) {
    return this.organisation.setup(req.user.id, dto.organisationName);
  }
}

/** Running the organisation: its name, admins and schools. 403 for non-admins. */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation')
export class OrganisationController {
  constructor(
    private readonly organisation: OrganisationService,
    private readonly features: FeatureService,
    private readonly uploadLimits: UploadLimitService,
    private readonly logos: SchoolLogoService,
    private readonly versioning: VersioningService,
  ) {}

  @Get()
  get() {
    return this.organisation.get();
  }

  @Patch()
  rename(@Req() req: Req, @Body() dto: UpdateOrganisationDto) {
    return this.organisation.rename(dto.name, req.user.id);
  }

  /** Platform features: the organisation's setting for each. */
  @Get('features')
  getFeatures() {
    return this.features.organisationFeatures();
  }

  @Patch('features')
  updateFeatures(@Req() req: Req, @Body() dto: UpdateFeaturesDto) {
    return this.features.updateOrganisationFeatures(dto.features, req.user.id);
  }

  @Get('overview')
  overview() {
    return this.organisation.overview();
  }

  @Get('admins')
  admins() {
    return this.organisation.admins();
  }

  @Post('admins')
  addAdmin(@Req() req: Req, @Body() dto: AdminEmailDto) {
    return this.organisation.addAdmin(req.user.id, dto.email);
  }

  @Delete('admins/:userId')
  removeAdmin(
    @Req() req: Req,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.organisation.removeAdmin(req.user.id, userId);
  }

  /** QUERY: `search` and `status` in the JSON body; empty lists every school. */
  @QueryMethod('schools')
  schools(@Body() dto: ListOrganisationSchoolsQueryDto) {
    return this.organisation.schools(dto.search, dto.status ?? 'all');
  }

  @Post('schools')
  createSchool(@Req() req: Req, @Body() dto: CreateOrganisationSchoolDto) {
    return this.organisation.createSchool(req.user.id, dto);
  }

  /** One school's row (as in the list) plus its logoUrl. */
  @Get('schools/:id')
  school(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.organisation.school(id);
  }

  @Patch('schools/:id')
  updateSchool(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOrganisationSchoolDto,
  ) {
    return this.organisation.updateSchool(id, dto, req.user.id);
  }

  @Put('schools/:id/admin')
  appointAdmin(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminEmailDto,
  ) {
    return this.organisation.appointAdmin(req.user.id, id, dto.email);
  }

  // --- one school's settings ----------------------------------------------
  // The same services and rules as the /schools/current/* routes, for any
  // school in the organisation (404 for an unknown one), so an organisation
  // admin configures a school without switching into it.

  @Get('schools/:id/upload-limit')
  async schoolUploadLimit(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(id);
    const raw = await this.uploadLimits.forSchool(id);
    return this.versioning.resolve(req, 'school.uploadLimit')(raw);
  }

  @Patch('schools/:id/upload-limit')
  async updateSchoolUploadLimit(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUploadLimitDto,
  ) {
    await this.organisation.requireSchool(id);
    const raw = await this.uploadLimits.setForSchool(
      id,
      dto.maxUploadMb,
      req.user.id,
    );
    return this.versioning.resolve(req, 'school.uploadLimit')(raw);
  }

  @Get('schools/:id/features')
  async schoolFeatures(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.organisation.requireSchool(id);
    return this.features.schoolFeatures(id);
  }

  @Patch('schools/:id/features')
  async updateSchoolFeatures(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFeaturesDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.features.updateSchoolFeatures(id, dto.features, req.user.id);
  }

  @Post('schools/:id/logo/upload-ticket')
  async schoolLogoTicket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateResumableUploadDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.logos.createTicket(id, dto.contentType, dto.totalSize);
  }

  @Post('schools/:id/logo/complete')
  @HttpCode(200)
  async schoolLogoComplete(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.logos.complete(id, dto.path, req.user.id);
  }

  @Delete('schools/:id/logo')
  async schoolLogoRemove(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(id);
    return this.logos.remove(id, req.user.id);
  }

  /** Sign any user out of every device (support: a compromised account). */
  @Post('users/:userId/sessions/revoke')
  @HttpCode(200)
  revokeUserSessions(
    @Req() req: Req,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.organisation.revokeUserSessions(req.user.id, userId);
  }
}
