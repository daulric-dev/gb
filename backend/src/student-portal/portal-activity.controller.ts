import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { StudentGuard, type StudentRequest } from './student.guard';
import { SubmissionService } from '@/grading/submission.service';
import {
  SubmitAssignmentDto,
  SubmitQuizDto,
} from '@/grading/dto/activity.dto';

/**
 * The student's view of work set for their classes.
 *
 * Every route resolves the student from StudentGuard, never from the request,
 * and the service checks the activity belongs to a class they are enrolled in.
 * Correct answers are never selected for these responses.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me/activities')
@UseGuards(AuthGuard, StudentGuard)
export class PortalActivityController {
  constructor(private readonly submissions: SubmissionService) {}

  /** Quizzes and assignments set for the classes this student is in. */
  @Get()
  async list(@Req() req: StudentRequest) {
    return this.submissions.listForStudent(req.student!.studentId);
  }

  @Get(':activityId')
  async get(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
  ) {
    return this.submissions.getForStudent(req.student!.studentId, activityId);
  }

  @Post(':activityId/submit')
  async submitAssignment(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
    @Body() dto: SubmitAssignmentDto,
  ) {
    return this.submissions.submitAssignment(
      req.student!.studentId,
      activityId,
      dto,
    );
  }

  /** Answers are scored on submit; there is one attempt. */
  @Post(':activityId/quiz')
  async submitQuiz(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
    @Body() dto: SubmitQuizDto,
  ) {
    return this.submissions.submitQuiz(
      req.student!.studentId,
      activityId,
      dto.answers,
    );
  }
}
