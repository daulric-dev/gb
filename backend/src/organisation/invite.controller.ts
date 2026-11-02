import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { INVITE_KINDS, InviteService, type InviteKind } from './invite.service';

type Req = { user: { id: string } };

/**
 * Open invites for people without an account yet (school admins and
 * organisation admins). Created by PUT /organisation/schools/:id/admin,
 * POST /organisation/schools (adminEmail) and POST /organisation/admins.
 */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation/invites')
export class InviteController {
  constructor(private readonly invites: InviteService) {}

  /** ?kind=school_admin|organisation_admin narrows it; all open ones otherwise. */
  @Get()
  list(@Query('kind') kind?: string) {
    if (kind && !(INVITE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`kind must be one of ${INVITE_KINDS.join(', ')}`);
    }
    return this.invites.list(kind as InviteKind | undefined);
  }

  @Delete(':id')
  revoke(@Req() req: Req, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invites.revoke(req.user.id, id);
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(@Req() req: Req, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invites.resend(req.user.id, id);
  }
}
