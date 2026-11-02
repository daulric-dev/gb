import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  QueryMethod,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { InviteService } from './invite.service';
import { ListInvitesQueryDto } from './dto/organisation.dto';

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

  /**
   * QUERY with `{ "kind": "school_admin" | "organisation_admin" }` narrows it;
   * an empty body lists every open invite. An unknown kind is a 400.
   */
  @QueryMethod()
  list(@Body() dto: ListInvitesQueryDto) {
    return this.invites.list(dto.kind);
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
