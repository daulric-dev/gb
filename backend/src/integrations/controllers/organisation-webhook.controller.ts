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
  QueryMethod,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { OrganisationService } from '@/organisation/organisation.service';
import { WebhookService } from '@/integrations/webhooks/webhook.service';
import { IntegrationAuditService, type IntegrationActor } from '@/integrations/audit/integration-audit.service';
import {
  CreateWebhookDto,
  ListDeliveriesQueryDto,
  ListIntegrationAuditQueryDto,
  UpdateWebhookDto,
} from '@/integrations/webhooks/dto/webhook.dto';

type Req = { user: { id: string } };

const asOrgAdmin = (req: Req): IntegrationActor => ({ id: req.user.id, via: 'organisation_admin' });

/**
 * Any school's webhooks from the organisation console, with the same bodies
 * and rules as the school admin's `/schools/current/webhooks`. 403 for
 * non-admins and while `integrations` is off for the school
 * (`:schoolId` is what FeatureGuard reads); 404 for an unknown school,
 * webhook or delivery.
 */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard, FeatureGuard)
@RequireFeature('integrations')
@Controller('organisation/schools/:schoolId/webhooks')
export class OrganisationWebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly audit: IntegrationAuditService,
    private readonly organisation: OrganisationService,
  ) {}

  @Get()
  async list(@Param('schoolId', new ParseUUIDPipe()) schoolId: string) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.list(schoolId);
  }

  @QueryMethod('audit')
  async auditLog(
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() dto: ListIntegrationAuditQueryDto,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.audit.list(schoolId, { limit: dto.limit, before: dto.before });
  }

  @RequireStepUp()
  @Post()
  async create(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.create(schoolId, dto, asOrgAdmin(req));
  }

  @Get('deliveries/:deliveryId')
  async delivery(
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.delivery(schoolId, deliveryId);
  }

  @Post('deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  async redeliver(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.redeliver(schoolId, deliveryId, asOrgAdmin(req));
  }

  @Get(':id')
  async get(
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.get(schoolId, id);
  }

  @RequireStepUp()
  @Patch(':id')
  async update(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.update(schoolId, id, dto, asOrgAdmin(req));
  }

  @RequireStepUp()
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(schoolId);
    await this.webhooks.remove(schoolId, id, asOrgAdmin(req));
  }

  @RequireStepUp()
  @Post(':id/rotate-secret')
  @HttpCode(200)
  async rotate(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.rotateSecret(schoolId, id, asOrgAdmin(req));
  }

  @Post(':id/test')
  @HttpCode(200)
  async test(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.test(schoolId, id, asOrgAdmin(req));
  }

  @QueryMethod(':id/deliveries')
  async deliveries(
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ListDeliveriesQueryDto,
  ) {
    await this.organisation.requireSchool(schoolId);
    return this.webhooks.listDeliveries(schoolId, id, dto);
  }
}
