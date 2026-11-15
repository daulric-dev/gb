import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { SchoolRetentionSettingsDto } from './school-retention.dto';
import { SchoolRetentionService } from './school-retention.service';

/**
 * The active school's retention periods for student records, and the list
 * of records due for erasure within 30 days. Changing a period or
 * confirming the list needs `student:erase` and step-up: both lead to
 * records being erased.
 */
@ApiTags('Retention')
@ApiBearerAuth()
@Controller('schools/current/retention')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolRetentionController {
  constructor(private readonly retention: SchoolRetentionService) {}

  @RequirePermission('student', 'erase')
  @Get()
  get(@Req() req: any) {
    return this.retention.view(req.user.id as string);
  }

  @RequirePermission('student', 'erase')
  @RequireStepUp()
  @Put()
  update(@Req() req: any, @Body() dto: SchoolRetentionSettingsDto) {
    return this.retention.update(req.user.id as string, dto);
  }

  /** Confirm the due list: from now on the daily purge erases due records. */
  @RequirePermission('student', 'erase')
  @RequireStepUp()
  @Post('confirm')
  @HttpCode(200)
  confirm(@Req() req: any) {
    return this.retention.confirm(req.user.id as string);
  }
}
