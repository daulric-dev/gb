import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { StudentMembershipService } from './student-membership.service';
import { IssueClaimCodeDto } from './dto/issue-claim-code.dto';

/**
 * The school's join code.
 *
 * Issuing is gated on student:create - redeeming a code creates a student, so
 * handing the code out hands out that ability.
 */
@ApiTags('Schools')
@ApiBearerAuth()
@Controller('schools/join-code')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolJoinCodeController {
  constructor(private readonly membership: StudentMembershipService) {}

  /** Whether a live code exists and when it lapses; never the code itself. */
  @RequirePermission('student', 'read')
  @Get()
  async status(@Req() req: any) {
    return this.membership.getCodeStatus(req.user.id as string);
  }

  /** Returns the plaintext once; only its hash is stored. */
  @RequirePermission('student', 'create')
  @Post()
  async issue(@Req() req: any, @Body() dto: IssueClaimCodeDto) {
    return this.membership.issueCode(req.user.id as string, dto.ttlDays);
  }

  @RequirePermission('student', 'create')
  @Delete()
  @HttpCode(204)
  async revoke(@Req() req: any) {
    await this.membership.revokeCode(req.user.id as string);
  }
}
