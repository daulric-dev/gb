import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { StudentGuard, type StudentRequest } from '@/student-portal/student.guard';
import { TimetableService } from './timetable.service';
import {
  ClosureDto,
  OccurrenceOverrideDto,
  PeriodDto,
  RangeQueryDto,
  RoomDto,
  TimetableEntryDto,
  UpdateTimetableSettingsDto,
} from './dto/timetable.dto';

/** The active school's rooms, bell schedule, closures and cycle. */
@ApiTags('Timetable')
@ApiBearerAuth()
@Controller('schools/current/timetable')
@UseGuards(AuthGuard, PermissionGuard, FeatureGuard)
@RequireFeature('timetable')
export class SchoolTimetableController {
  constructor(private readonly timetable: TimetableService) {}

  private async school(req: any) {
    return this.timetable.schoolOf(req.user.id as string);
  }

  @RequirePermission('school', 'read')
  @Get()
  async setup(@Req() req: any) {
    return this.timetable.setup(await this.school(req));
  }

  @RequirePermission('school', 'read')
  @Get('cycle')
  async cycle(@Req() req: any, @Query() q: RangeQueryDto) {
    return this.timetable.cyclePreview(await this.school(req), q.from, q.to);
  }

  @RequirePermission('school', 'update')
  @Patch('settings')
  async settings(@Req() req: any, @Body() dto: UpdateTimetableSettingsDto) {
    return this.timetable.updateSettings(req.user.id as string, await this.school(req), dto);
  }

  @RequirePermission('school', 'update')
  @Post('rooms')
  async createRoom(@Req() req: any, @Body() dto: RoomDto) {
    return this.timetable.createRoom(await this.school(req), dto);
  }

  @RequirePermission('school', 'update')
  @Patch('rooms/:roomId')
  async updateRoom(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: RoomDto,
  ) {
    return this.timetable.updateRoom(await this.school(req), roomId, dto);
  }

  @RequirePermission('school', 'update')
  @Delete('rooms/:roomId')
  @HttpCode(204)
  async deleteRoom(@Req() req: any, @Param('roomId', ParseUUIDPipe) roomId: string) {
    await this.timetable.deleteRoom(await this.school(req), roomId);
  }

  @RequirePermission('school', 'update')
  @Post('periods')
  async createPeriod(@Req() req: any, @Body() dto: PeriodDto) {
    return this.timetable.createPeriod(await this.school(req), dto);
  }

  @RequirePermission('school', 'update')
  @Patch('periods/:periodId')
  async updatePeriod(
    @Req() req: any,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @Body() dto: PeriodDto,
  ) {
    return this.timetable.updatePeriod(await this.school(req), periodId, dto);
  }

  @RequirePermission('school', 'update')
  @Delete('periods/:periodId')
  @HttpCode(204)
  async deletePeriod(@Req() req: any, @Param('periodId', ParseUUIDPipe) periodId: string) {
    await this.timetable.deletePeriod(await this.school(req), periodId);
  }

  @RequirePermission('school', 'update')
  @Post('closures')
  async createClosure(@Req() req: any, @Body() dto: ClosureDto) {
    return this.timetable.createClosure(req.user.id as string, await this.school(req), dto);
  }

  @RequirePermission('school', 'update')
  @Delete('closures/:closureId')
  @HttpCode(204)
  async deleteClosure(@Req() req: any, @Param('closureId', ParseUUIDPipe) closureId: string) {
    await this.timetable.deleteClosure(await this.school(req), closureId);
  }
}

/** One course's timetable. Access is the caller's course role. */
@ApiTags('Timetable')
@ApiBearerAuth()
@Controller('courses/:courseId/timetable')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('timetable')
export class CourseTimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  async get(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.timetable.courseTimetable(req.user.id as string, courseId);
  }

  @Post('entries')
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: TimetableEntryDto,
  ) {
    return this.timetable.createEntry(req.user.id as string, courseId, dto);
  }

  @Patch('entries/:entryId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: TimetableEntryDto,
  ) {
    return this.timetable.updateEntry(req.user.id as string, courseId, entryId, dto);
  }

  @Delete('entries/:entryId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    await this.timetable.deleteEntry(req.user.id as string, courseId, entryId);
  }

  @Get('occurrences')
  async occurrences(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query() q: RangeQueryDto,
  ) {
    return this.timetable.courseOccurrences(req.user.id as string, courseId, q.from, q.to);
  }

  @Put('occurrences/:entryId/:date')
  async override(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Param('date') date: string,
    @Body() dto: OccurrenceOverrideDto,
  ) {
    return this.timetable.setOverride(req.user.id as string, courseId, entryId, date, dto);
  }

  @Delete('occurrences/:entryId/:date')
  @HttpCode(204)
  async restore(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Param('date') date: string,
  ) {
    await this.timetable.clearOverride(req.user.id as string, courseId, entryId, date);
  }
}

/** A member of staff's own periods (the "today" view). */
@ApiTags('Timetable')
@ApiBearerAuth()
@Controller('timetable')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('timetable')
export class MyTimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('me')
  async mine(@Req() req: any, @Query() q: RangeQueryDto) {
    return this.timetable.myOccurrences(req.user.id as string, q.from, q.to);
  }
}

/** The signed-in student's timetable (default: this week). */
@ApiTags('Timetable')
@ApiBearerAuth()
@Controller('portal/me/timetable')
@UseGuards(AuthGuard, StudentGuard, FeatureGuard)
@RequireFeature('timetable')
export class PortalTimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  async mine(@Req() req: StudentRequest, @Query() q: RangeQueryDto) {
    const s = req.student!;
    return this.timetable.studentOccurrences(s.studentId, s.schoolId, q.from, q.to);
  }
}
