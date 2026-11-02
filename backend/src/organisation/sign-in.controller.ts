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
import { SsoAuditService, type SsoActor } from '@/sso/sso-audit.service';
import { ListSsoAuditQueryDto } from '@/sso/sso-audit.dto';
import { RequireStepUp } from '@/auth/step-up.guard';
import { OrganisationService } from './organisation.service';

type Req = FastifyRequest & { user: { id: string } };

const asOrgAdmin = (req: Req): SsoActor => ({ id: req.user.id, via: 'organisation_admin' });

/**
 * Sign-in from the organisation console, school by school: each school's own
 * sign-in apps (on/off, client credentials) and email domains, with the same
 * bodies and rules as a school admin's `/schools/current/sso/providers` and
 * `/schools/email-domains` routes, plus an overview of every school's
 * domains. 403 for non-admins; 404 for an unknown school, domain or provider.
 * Every write needs a recent step-up confirmation (`@RequireStepUp()`) and
 * is written to the school's SSO audit log, readable at
 * `schools/:id/sso/audit`.
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
    private readonly ssoAudit: SsoAuditService,
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

  @RequireStepUp()
  @Put('schools/:id/sso/providers/:key')
  async updateSchoolProvider(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
    @Body() dto: UpdateSchoolSsoProviderDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.schoolSso.update(id, key, dto, asOrgAdmin(req), req);
  }

  /** One school's single sign-on activity, newest first (see SsoAuditService.list). */
  @QueryMethod('schools/:id/sso/audit')
  async schoolSsoAudit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ListSsoAuditQueryDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.ssoAudit.list(id, { limit: dto.limit, before: dto.before });
  }

  // ── one school's domains ──────────────────────────────────────────────────

  @Get('schools/:id/email-domains')
  async schoolDomains(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.organisation.requireSchool(id);
    return this.domains.listForSchool(id);
  }

  @RequireStepUp()
  @Post('schools/:id/email-domains')
  async addSchoolDomain(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddEmailDomainDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.domains.addToSchool(id, asOrgAdmin(req), dto);
  }

  @RequireStepUp()
  @Patch('schools/:id/email-domains/:domainId')
  async updateSchoolDomain(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @Body() dto: UpdateEmailDomainDto,
  ) {
    await this.organisation.requireSchool(id);
    return this.domains.updateInSchool(id, domainId, dto, asOrgAdmin(req));
  }

  @RequireStepUp()
  @Delete('schools/:id/email-domains/:domainId')
  @HttpCode(204)
  async removeSchoolDomain(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
  ) {
    await this.organisation.requireSchool(id);
    await this.domains.removeFromSchool(id, domainId, asOrgAdmin(req));
  }

  // A DNS lookup per call, as on the school admin's route.
  @Throttle({ 'claim-code': { limit: 20, ttl: 15 * 60 * 1000 } })
  @RequireStepUp()
  @Post('schools/:id/email-domains/:domainId/verify')
  @HttpCode(200)
  async verifySchoolDomain(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
  ) {
    await this.organisation.requireSchool(id);
    return this.domains.verifyInSchool(id, domainId, asOrgAdmin(req));
  }
}
