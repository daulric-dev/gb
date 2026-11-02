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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import {
  AddEmailDomainDto,
  UpdateEmailDomainDto,
} from '@/email-domain/dto/email-domain.dto';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { SchoolSsoService } from '@/sso/school-sso.service';
import { UpdateSchoolSsoProviderDto } from '@/sso/school-sso.dto';
import { OrganisationService } from './organisation.service';

type Req = FastifyRequest & { user: { id: string } };

/**
 * Sign-in from the organisation console, school by school: each school's own
 * sign-in apps (on/off, client credentials) and email domains, with the same
 * bodies and rules as a school admin's `/schools/current/sso/providers` and
 * `/schools/email-domains` routes, plus an overview of every school's
 * domains. 403 for non-admins; 404 for an unknown school, domain or provider.
 */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation')
export class SignInController {
  constructor(
    private readonly schoolSso: SchoolSsoService,
    private readonly domains: EmailDomainService,
    private readonly organisation: OrganisationService,
  ) {}

  /** Every school's domains, with the school's name (the Overview page). */
  @Get('sign-in/domains')
  allDomains() {
    return this.domains.listAll();
  }

  // ── one school's sign-in apps ─────────────────────────────────────────────

  @Get('schools/:id/sso/providers')
  async schoolProviders(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(id);
    return this.schoolSso.list(id, req);
  }

  @Put('schools/:id/sso/providers/:key')
  async updateSchoolProvider(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
    @Body() dto: UpdateSchoolSsoProviderDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.schoolSso.update(id, key, dto, req.user.id, req);
  }

  // ── one school's domains ──────────────────────────────────────────────────

  @Get('schools/:id/email-domains')
  async schoolDomains(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.organisation.requireSchool(id);
    return this.domains.listForSchool(id);
  }

  @Post('schools/:id/email-domains')
  async addSchoolDomain(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddEmailDomainDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.domains.addToSchool(id, req.user.id, dto);
  }

  @Patch('schools/:id/email-domains/:domainId')
  async updateSchoolDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @Body() dto: UpdateEmailDomainDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.domains.updateInSchool(id, domainId, dto);
  }

  @Delete('schools/:id/email-domains/:domainId')
  @HttpCode(204)
  async removeSchoolDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
  ) {
    await this.organisation.requireSchool(id);
    await this.domains.removeFromSchool(id, domainId);
  }

  // A DNS lookup per call, as on the school admin's route.
  @Throttle({ 'claim-code': { limit: 20, ttl: 15 * 60 * 1000 } })
  @Post('schools/:id/email-domains/:domainId/verify')
  @HttpCode(200)
  async verifySchoolDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
  ) {
    await this.organisation.requireSchool(id);
    return this.domains.verifyInSchool(id, domainId);
  }
}
