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
import { StudentClaimService } from './student-claim.service';
import { IssueClaimCodeDto } from './dto/issue-claim-code.dto';

/**
 * The school's join code: students redeem it to create their own record and
 * join, without staff creating the record first.
 *
 * Gated on student:create - redeeming one creates a student, so issuing it
 * hands out that ability.
 */
@ApiTags('Schools')
@ApiBearerAuth()
@Controller('schools/join-code')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolJoinCodeController {
  constructor(private readonly studentClaimService: StudentClaimService) {}

  /** Whether a live code exists and when it lapses; never the code itself. */
  @RequirePermission('student', 'read')
  @Get()
  async status(@Req() req: any) {
    const userId: string = req.user.id;
    return this.studentClaimService.getSchoolCodeStatus(userId);
  }

  /** Returns the plaintext once; only its hash is stored. */
  @RequirePermission('student', 'create')
  @Post()
  async issue(@Req() req: any, @Body() dto: IssueClaimCodeDto) {
    const userId: string = req.user.id;
    return this.studentClaimService.issueSchoolCode(userId, dto.ttlDays);
  }

  @RequirePermission('student', 'create')
  @Delete()
  @HttpCode(204)
  async revoke(@Req() req: any) {
    const userId: string = req.user.id;
    await this.studentClaimService.revokeSchoolCode(userId);
  }
}
