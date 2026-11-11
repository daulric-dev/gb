import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { StudentRestrictionService } from './student-restriction.service';
import { UpdateStudentRestrictionsDto } from './dto/update-restrictions.dto';

/**
 * A student's restriction / objection flags, on the student's page. Reading
 * and changing both need `student:update`; the student must be in the
 * caller's active school.
 */
@ApiTags('Students')
@ApiBearerAuth()
@Controller('students/:studentId/restrictions')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentRestrictionController {
  constructor(private readonly restrictions: StudentRestrictionService) {}

  @RequirePermission('student', 'update')
  @Get()
  get(@Req() req: { user: { id: string } }, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.restrictions.get(req.user.id, studentId);
  }

  @RequirePermission('student', 'update')
  @Put()
  update(
    @Req() req: { user: { id: string } },
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: UpdateStudentRestrictionsDto,
  ) {
    return this.restrictions.update(req.user.id, studentId, dto);
  }
}
