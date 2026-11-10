import {
  Body,
  Controller,
  Get,
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
import { SimilarityService } from './similarity.service';
import { SimilaritySettingsDto } from './similarity.dto';

/**
 * Teachers' similarity markers and side-by-side view. Staff role in the
 * activity's course, and `similarity_check` on for its school, checked by
 * the service. There is no student route.
 */
@ApiTags('Similarity')
@ApiBearerAuth()
@Controller('activities/:activityId/similarity')
@UseGuards(AuthGuard)
export class SimilarityController {
  constructor(private readonly similarity: SimilarityService) {}

  /** Roster markers above the school's threshold. */
  @Get()
  async flags(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.similarity.activityFlags(req.user.id as string, activityId);
  }

  @Get('submissions/:submissionId')
  async matches(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.similarity.submissionMatches(req.user.id as string, activityId, submissionId);
  }

  /** Side by side, shared passages marked. */
  @Get('compare/:fingerprintId/:otherId')
  async compare(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('fingerprintId', ParseUUIDPipe) fingerprintId: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
  ) {
    return this.similarity.compare(req.user.id as string, activityId, fingerprintId, otherId);
  }
}

/** The active school's settings (`school:update`). */
@ApiTags('Similarity')
@ApiBearerAuth()
@Controller('schools/current/similarity')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolSimilarityController {
  constructor(private readonly similarity: SimilarityService) {}

  @RequirePermission('school', 'update')
  @Get()
  async get(@Req() req: any) {
    return this.similarity.getSchoolSettings(req.user.id as string);
  }

  @RequirePermission('school', 'update')
  @Put()
  async update(@Req() req: any, @Body() dto: SimilaritySettingsDto) {
    return this.similarity.updateSchoolSettings(req.user.id as string, dto);
  }
}
