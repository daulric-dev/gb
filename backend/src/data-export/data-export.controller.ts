import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { DataExportService } from './data-export.service';
import { DOWNLOAD_THROTTLE, REQUEST_THROTTLE } from './data-export.constants';

type Req = { user: { id: string } };
const uuid = new ParseUUIDPipe();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Subject access / data portability exports. Asking for one and downloading
 * it both need step-up ("Confirm it's you") and are rate-limited per route;
 * who may export whose data is decided in DataExportService (see
 * data-export-access.ts). Only the person who asked can see or download an
 * export.
 */
@ApiTags('Data export')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('data-exports')
export class DataExportController {
  constructor(private readonly exports: DataExportService) {}

  @Get()
  @ApiQuery({ name: 'studentId', required: false })
  list(@Req() req: Req, @Query('studentId') studentId?: string) {
    return this.exports.list(req.user.id, studentId && UUID.test(studentId) ? studentId : undefined);
  }

  /** Your own account. */
  @RequireStepUp()
  @Throttle(REQUEST_THROTTLE)
  @Post('me')
  requestSelf(@Req() req: Req) {
    return this.exports.requestSelf(req.user.id);
  }

  /** Staff with `student:export` in the student's school. */
  @RequireStepUp()
  @Throttle(REQUEST_THROTTLE)
  @Post('students/:studentId')
  requestStudent(@Req() req: Req, @Param('studentId', uuid) studentId: string) {
    return this.exports.requestStudent(req.user.id, studentId);
  }

  /** A parent, for a linked child (what the school shows parents). */
  @RequireStepUp()
  @Throttle(REQUEST_THROTTLE)
  @Post('children/:studentId')
  requestChild(@Req() req: Req, @Param('studentId', uuid) studentId: string) {
    return this.exports.requestChild(req.user.id, studentId);
  }

  @Get(':id')
  get(@Req() req: Req, @Param('id', uuid) id: string) {
    return this.exports.get(req.user.id, id);
  }

  /** A 5-minute signed URL for the ZIP. */
  @RequireStepUp()
  @Throttle(DOWNLOAD_THROTTLE)
  @Post(':id/download')
  @HttpCode(200)
  download(@Req() req: Req, @Param('id', uuid) id: string) {
    return this.exports.download(req.user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Req, @Param('id', uuid) id: string) {
    await this.exports.remove(req.user.id, id);
  }
}
