import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { MultipartFile } from '@fastify/multipart';
import { AuthGuard } from '@/auth/auth.guard';
import { StudentGuard, type StudentRequest } from './student.guard';
import { SubmissionService } from '@/grading/submission.service';
import { SubmitAssignmentDto, SubmitQuizDto } from '@/grading/dto/activity.dto';
import { CreateUploadTicketDto } from '@/file-manager/dto/upload-ticket.dto';

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

  /**
   * Start a resumable upload for this assignment. The browser sends the bytes
   * to Storage over TUS, then calls the complete endpoint below.
   *
   * Students hold no catalog permissions, so the portal is the only place they
   * can obtain a ticket.
   */
  @Post(':activityId/upload-ticket')
  async createUploadTicket(
    @Req() req: StudentRequest,
    @Param('activityId') activityId: string,
    @Body() dto: CreateUploadTicketDto,
  ) {
    return this.submissions.createUploadTicket(
      req.student!.studentId,
      activityId,
      dto,
    );
  }

  /** Scan the uploaded bytes and attach the file to the draft. */
  @Post(':activityId/upload-ticket/:fileId/complete')
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
  @Post(':activityId/file')
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
