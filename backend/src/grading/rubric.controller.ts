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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { RubricService } from './rubric.service';
import {
  AssessRubricDto,
  AttachRubricDto,
  CreateRubricDto,
  UpdateRubricDto,
} from './dto/rubric.dto';

/**
 * A course's rubrics, attaching one to an activity, and marking with it.
 * Staff read and mark; the teacher (or a school admin) builds and attaches.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class RubricController {
  constructor(private readonly rubrics: RubricService) {}

  @Get('courses/:courseId/rubrics')
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.rubrics.list(req.user.id as string, courseId);
  }

  @Post('courses/:courseId/rubrics')
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateRubricDto,
  ) {
    return this.rubrics.create(req.user.id as string, courseId, dto);
  }

  @Get('courses/:courseId/rubrics/:rubricId')
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
  ) {
    return this.rubrics.get(req.user.id as string, courseId, rubricId);
  }

  @Patch('courses/:courseId/rubrics/:rubricId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
    @Body() dto: UpdateRubricDto,
  ) {
    return this.rubrics.update(req.user.id as string, courseId, rubricId, dto);
  }

  @Post('courses/:courseId/rubrics/:rubricId/copy')
  async copy(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
  ) {
    return this.rubrics.copy(req.user.id as string, courseId, rubricId);
  }

  @Delete('courses/:courseId/rubrics/:rubricId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
  ) {
    await this.rubrics.remove(req.user.id as string, courseId, rubricId);
  }

  /** The activity's rubric and each student's criterion marks. */
  @Get('activities/:activityId/rubric')
  async forActivity(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ) {
    return this.rubrics.forActivity(req.user.id as string, activityId);
  }

  @Put('activities/:activityId/rubric')
  async attach(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: AttachRubricDto,
  ) {
    return this.rubrics.attach(req.user.id as string, activityId, dto.rubricId);
  }

  /** Mark with the rubric; the score is the criteria's sum unless given. */
  @Put('activities/:activityId/submissions/:studentId/rubric')
  async assess(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: AssessRubricDto,
  ) {
    return this.rubrics.assess(
      req.user.id as string,
      activityId,
      studentId,
      dto,
    );
  }
}
