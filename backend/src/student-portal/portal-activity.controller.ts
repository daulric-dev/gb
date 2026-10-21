import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { MultipartFile } from '@fastify/multipart';
import { AuthGuard } from '@/auth/auth.guard';
import { StudentGuard, type StudentRequest } from './student.guard';
import { SubmissionService } from '@/grading/submission.service';
import { GradebookService } from '@/grading/gradebook.service';
import { SubmitAssignmentDto, SubmitQuizDto } from '@/grading/dto/activity.dto';
import { CreateUploadTicketDto } from '@/file-manager/dto/upload-ticket.dto';

/**
 * A student's own work: the to-do across their courses, one course's
 * activities and grades, and handing work in. The student is always the one
 * StudentGuard resolved from the session, never an id from the client.
 */
@ApiTags('Student Portal')
@ApiBearerAuth()
@Controller('portal/me')
@UseGuards(AuthGuard, StudentGuard)
export class PortalActivityController {
  constructor(
    private readonly submissions: SubmissionService,
    private readonly gradebook: GradebookService,
  ) {}

  /** Published work across every course the student can see. */
  @Get('activities')
  async list(@Req() req: StudentRequest) {
    return this.submissions.listForStudent(req.student!.studentId);
  }

  /** One course's published and closed work, with the student's state. */
  @Get('courses/:courseId/activities')
  async courseActivities(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.submissions.listCourseForStudent(
      req.student!.studentId,
      courseId,
    );
  }

  /** The student's scores by group, total and letter in one course. */
  @Get('courses/:courseId/grades')
  async courseGrades(
    @Req() req: StudentRequest,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.gradebook.studentGrades(req.student!.studentId, courseId);
  }

  @Get('activities/:activityId')
  async get(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
  ) {
    return this.submissions.getForStudent(req.student!.studentId, activityId);
  }

  /**
   * Start a resumable upload for this assignment. The browser sends the bytes
   * to Storage over TUS, then calls the complete endpoint below.
   *
   * Students hold no catalog permissions, so the portal is the only place they
   * can obtain a ticket.
   */
  @Post('activities/:activityId/upload-ticket')
  async createUploadTicket(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
    @Body() dto: CreateUploadTicketDto,
  ) {
    return this.submissions.createUploadTicket(
      req.student!.studentId,
      activityId,
      dto,
      (req as { headers?: { host?: string } }).headers?.host,
    );
  }

  /** Scan the uploaded bytes and attach the file to the draft. */
  @Post('activities/:activityId/upload-ticket/:fileId/complete')
  async finaliseUpload(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.submissions.finaliseUploadedFile(
      req.student!.studentId,
      activityId,
      fileId,
    );
  }

  /**
   * Attach a file in one request. Kept for small files and as a fallback when
   * a resumable upload cannot be used; the path above is preferred.
   */
  @Post('activities/:activityId/file')
  @ApiConsumes('multipart/form-data')
  async attachFile(
    @Req() req: StudentRequest & { file: () => Promise<MultipartFile> },
    @Param('activityId') activityId: string,
  ) {
    const file = await req.file();
    return this.submissions.attachFile(
      req.student!.studentId,
      activityId,
      file,
    );
  }

  @Post('activities/:activityId/submit')
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

  /** Answers are scored on submit, up to the quiz's attempt limit. */
  @Post('activities/:activityId/quiz')
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
