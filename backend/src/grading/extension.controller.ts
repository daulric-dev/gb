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
import { ExtensionService } from './extension.service';
import { SetExtensionDto } from './dto/extension.dto';

/**
 * Per-student due date extensions. Like marking, access is the caller's
 * staff role in the activity's course, checked by the service.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('activities/:activityId/extensions')
@UseGuards(AuthGuard)
export class ExtensionController {
  constructor(private readonly extensions: ExtensionService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.extensions.list(req.user.id as string, activityId);
  }

  /** Set or replace one student's due date on this activity. */
  @Put(':studentId')
  async set(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetExtensionDto,
  ) {
    return this.extensions.set(
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
    await this.extensions.remove(req.user.id as string, activityId, studentId);
  }
}
