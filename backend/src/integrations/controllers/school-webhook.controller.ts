import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { AdminGuard } from '@/auth/admin.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { isOrgAdmin } from '@/organisation/org-admin';
import { WebhookService } from '@/integrations/webhooks/webhook.service';
import { IntegrationAuditService, type IntegrationActor } from '@/integrations/audit/integration-audit.service';
import {
  CreateWebhookDto,
  ListDeliveriesQueryDto,
  ListIntegrationAuditQueryDto,
  RotateSecretDto,
  UpdateWebhookDto,
} from '@/integrations/webhooks/dto/webhook.dto';
import { eventTypeCatalog } from '@/integrations/events/webhook-event-types';

type Req = { user: { id: string } };

const asSchoolAdmin = (req: Req): IntegrationActor => ({ id: req.user.id, via: 'school_admin' });

/**
 * The active school's webhooks, for its admin (`school:update` and the
 * school's admin role, or an organisation admin working in it). 403
 * FEATURE_DISABLED while the `integrations` feature is off for the school.
 * Create, update, delete and rotate-secret need a recent step-up
 * confirmation; every change, test and redelivery is audit-logged.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard, AdminGuard, FeatureGuard)
@RequireFeature('integrations')
@Controller('schools/current/webhooks')
export class SchoolWebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly audit: IntegrationAuditService,
    private readonly prisma: PrismaService,
  ) {}

  private async school(req: Req): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, req.user.id);
    if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
    return schoolId;
  }

  @RequirePermission('school', 'update')
  @Get()
  async list(@Req() req: Req) {
    return this.webhooks.list(await this.school(req));
  }

  /** The integrations activity log, newest first. */
  @RequirePermission('school', 'update')
  @QueryMethod('audit')
  async auditLog(@Req() req: Req, @Body() dto: ListIntegrationAuditQueryDto) {
    return this.audit.list(await this.school(req), { limit: dto.limit, before: dto.before });
  }

  /** The secret is in the answer, once. */
  @RequirePermission('school', 'update')
  @RequireStepUp()
  @Post()
  async create(@Req() req: Req, @Body() dto: CreateWebhookDto) {
    return this.webhooks.create(await this.school(req), dto, asSchoolAdmin(req));
  }

  @RequirePermission('school', 'update')
  @Get('deliveries/:deliveryId')
  async delivery(@Req() req: Req, @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string) {
    return this.webhooks.delivery(await this.school(req), deliveryId);
  }

  @RequirePermission('school', 'update')
  @Post('deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  async redeliver(@Req() req: Req, @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string) {
    return this.webhooks.redeliver(await this.school(req), deliveryId, asSchoolAdmin(req));
  }

  @RequirePermission('school', 'update')
  @Get(':id')
  async get(@Req() req: Req, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webhooks.get(await this.school(req), id);
  }

  @RequirePermission('school', 'update')
  @RequireStepUp()
  @Patch(':id')
  async update(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(await this.school(req), id, dto, asSchoolAdmin(req));
  }

  @RequirePermission('school', 'update')
  @RequireStepUp()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Req, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.webhooks.remove(await this.school(req), id, asSchoolAdmin(req));
  }

  @RequirePermission('school', 'update')
  @RequireStepUp()
  @Post(':id/rotate-secret')
  @HttpCode(200)
  async rotate(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RotateSecretDto,
  ) {
    return this.webhooks.rotateSecret(await this.school(req), id, asSchoolAdmin(req), dto.signingSecret);
  }

  /** Sends a `ping` now. No step-up: it changes nothing. Audit-logged. */
  @RequirePermission('school', 'update')
  @Post(':id/test')
  @HttpCode(200)
  async test(@Req() req: Req, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webhooks.test(await this.school(req), id, asSchoolAdmin(req));
  }

  @RequirePermission('school', 'update')
  @QueryMethod(':id/deliveries')
  async deliveries(
    @Req() req: Req,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ListDeliveriesQueryDto,
  ) {
    return this.webhooks.listDeliveries(await this.school(req), id, dto);
  }
}

/**
 * The webhook event type catalog: key, group, label, description, JSON
 * Schema of `data` and an example. For any school admin or organisation
 * admin; needs no school and no feature (docs and set-up screens read it).
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('webhooks')
export class WebhookEventTypesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('event-types')
  async eventTypes(@Req() req: Req) {
    const userId = req.user.id;
    const allowed =
      (await isOrgAdmin(this.prisma, userId).catch(() => false)) ||
      !!(await this.prisma.school_management
        .findFirst({ where: { user_id: userId, role: 'admin' }, select: { id: true } })
        .catch(() => null));
    if (!allowed) throw new ForbiddenException('Admin access required');
    return eventTypeCatalog();
  }
}
