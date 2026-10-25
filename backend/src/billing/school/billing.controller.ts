import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { BillingEnabledGuard } from '../access/billing.guards';
import { BillingService, type Caller } from './billing.service';
import { ChangePlanDto, CheckoutDto } from '../dto/billing.dto';

type Req = { user: Caller };

/** GET /billing/status: answers on every deployment, so the apps know to hide billing. */
@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('billing')
export class BillingStatusController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  status(@Req() req: Req) {
    return this.billing.status(req.user.id);
  }
}

/** A school admin's billing (school:update in their active school). */
@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(BillingEnabledGuard, AuthGuard, PermissionGuard)
@RequirePermission('school', 'update')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  summary(@Req() req: Req) {
    return this.billing.summary(req.user.id);
  }

  @Post('checkout')
  @HttpCode(200)
  checkout(@Req() req: Req, @Body() dto: CheckoutDto) {
    return this.billing.checkout(req.user, dto.plan, dto.provider);
  }

  @Post('change-plan')
  @HttpCode(200)
  changePlan(@Req() req: Req, @Body() dto: ChangePlanDto) {
    return this.billing.changePlan(req.user.id, dto.plan);
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(@Req() req: Req) {
    return this.billing.setCancel(req.user.id, true);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@Req() req: Req) {
    return this.billing.setCancel(req.user.id, false);
  }

  @Post('portal')
  @HttpCode(200)
  portal(@Req() req: Req) {
    return this.billing.portal(req.user.id);
  }

  @Get('invoices')
  invoices(@Req() req: Req) {
    return this.billing.listInvoices(req.user.id);
  }

}
