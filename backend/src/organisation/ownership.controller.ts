import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { OwnershipService } from './ownership.service';
import { TransferOwnershipDto } from './dto/organisation.dto';

type Req = { user: { id: string } };

/**
 * Handing a school to another of its staff. Open to the school's owner, the
 * holder of its admin seat while it has no owner, and organisation admins
 * (OwnershipService decides: 403 otherwise, 404 for an unknown school), so
 * it takes a school id rather than the caller's active school: an
 * organisation admin need not be a member, and an owner may own a school
 * that is not their active one. The organisation's own transfer is
 * `POST /organisation/transfer-ownership` (OrganisationController).
 */
@ApiTags('Schools')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('schools')
export class SchoolOwnershipController {
  constructor(private readonly ownership: OwnershipService) {}

  /** `{ schoolId, schoolName, owner, candidates: [{ userId, name, email, role }] }`. */
  @Get(':schoolId/transfer-ownership/candidates')
  candidates(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ) {
    return this.ownership.schoolCandidates(req.user.id, schoolId);
  }

  @RequireStepUp()
  @Post(':schoolId/transfer-ownership')
  @HttpCode(200)
  transfer(
    @Req() req: Req,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.ownership.transferSchool(req.user.id, schoolId, dto.userId);
  }
}
