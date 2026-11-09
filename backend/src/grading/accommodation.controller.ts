import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { AccommodationService } from './accommodation.service';
import { SetAccommodationDto } from './dto/accommodation.dto';

/**
 * Per-student quiz accommodations on one activity. Like extensions, access is
 * the caller's staff role in the activity's course, checked by the service.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('activities/:activityId/accommodations')
@UseGuards(AuthGuard)
export class ActivityAccommodationController {
  constructor(private readonly accommodations: AccommodationService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.accommodations.listForActivity(
      req.user.id as string,
      activityId,
    );
  }

  /** Set or replace one student's accommodation on this quiz. */
  @Put(':studentId')
  async set(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetAccommodationDto,
  ) {
    return this.accommodations.setForActivity(
      req.user.id as string,
      activityId,
      studentId,
      dto,
    );
  }

  @Delete(':studentId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    await this.accommodations.removeForActivity(
      req.user.id as string,
      activityId,
      studentId,
    );
  }
}

/**
 * A student's school-wide default accommodation, applied to every timed or
 * Lockdown quiz unless one activity overrides it. School staff with the
 * student permissions; the service scopes the student to the caller's school.
 */
@ApiTags('Students')
@ApiBearerAuth()
@Controller('students/:studentId/accommodation')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentAccommodationController {
  constructor(private readonly accommodations: AccommodationService) {}

  /** The default, or null when the student has none. */
  @RequirePermission('student', 'read')
  @Get()
  async get(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.accommodations.getForStudent(req.user.id as string, studentId);
  }

  @RequirePermission('student', 'update')
  @Put()
  async set(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetAccommodationDto,
  ) {
    return this.accommodations.setForStudent(
      req.user.id as string,
      studentId,
      dto,
    );
  }

  @RequirePermission('student', 'update')
  @Delete()
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    await this.accommodations.removeForStudent(
      req.user.id as string,
      studentId,
    );
  }
}
