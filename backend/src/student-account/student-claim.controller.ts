import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
 * Staff-side management of student claim codes. Issuing a code is what lets a
 * student create a login for a record, so it is gated on student:update -
 * the same permission as editing the record itself.
 */
@ApiTags('Students')
@ApiBearerAuth()
@Controller('students/:studentId/claim-code')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentClaimController {
  constructor(private readonly studentClaimService: StudentClaimService) {}

  @RequirePermission('student', 'read')
  @Get()
  async status(@Req() req: any, @Param('studentId') studentId: string) {
    const userId: string = req.user.id;
    return this.studentClaimService.getStatus(userId, studentId);
  }

  /** Returns the plaintext code once; only its hash is stored. */
  @RequirePermission('student', 'update')
  @Post()
  async issue(
    @Req() req: any,
    @Param('studentId') studentId: string,
    @Body() dto: IssueClaimCodeDto,
  ) {
    const userId: string = req.user.id;
    return this.studentClaimService.issue(userId, studentId, dto.ttlDays);
  }

  @RequirePermission('student', 'update')
  @Delete()
  @HttpCode(204)
  async revoke(@Req() req: any, @Param('studentId') studentId: string) {
    const userId: string = req.user.id;
    await this.studentClaimService.revoke(userId, studentId);
  }
}
