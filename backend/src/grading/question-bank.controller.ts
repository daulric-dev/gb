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
import { QuestionBankService } from './question-bank.service';
import { AddQuestionDto, UpdateQuestionDto } from './dto/activity.dto';
import { QuestionBankDto, SetBankDrawsDto } from './dto/question-bank.dto';

/**
 * Question banks: staff read them, the teacher (or a school admin) builds
 * them. Access is the course role, through the service.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class QuestionBankController {
  constructor(private readonly banks: QuestionBankService) {}

  @Get('courses/:courseId/question-banks')
  async list(@Req() req: any, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.banks.list(req.user.id as string, courseId);
  }

  @Post('courses/:courseId/question-banks')
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: QuestionBankDto,
  ) {
    return this.banks.create(req.user.id as string, courseId, dto);
  }

  @Get('question-banks/:bankId')
  async get(@Req() req: any, @Param('bankId', ParseUUIDPipe) bankId: string) {
    return this.banks.get(req.user.id as string, bankId);
  }

  @Patch('question-banks/:bankId')
  async rename(
    @Req() req: any,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: QuestionBankDto,
  ) {
    return this.banks.rename(req.user.id as string, bankId, dto);
  }

  @Delete('question-banks/:bankId')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('bankId', ParseUUIDPipe) bankId: string) {
    await this.banks.remove(req.user.id as string, bankId);
  }

  @Post('question-banks/:bankId/questions')
  async addQuestion(
    @Req() req: any,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: AddQuestionDto,
  ) {
    return this.banks.addQuestion(req.user.id as string, bankId, dto);
  }

  @Patch('question-banks/:bankId/questions/:questionId')
  async updateQuestion(
    @Req() req: any,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.banks.updateQuestion(req.user.id as string, bankId, questionId, dto);
  }

  @Delete('question-banks/:bankId/questions/:questionId')
  @HttpCode(204)
  async removeQuestion(
    @Req() req: any,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.banks.removeQuestion(req.user.id as string, bankId, questionId);
  }

  /** Replace a draft quiz's bank draws. */
  @Put('activities/:activityId/bank-draws')
  async setDraws(
    @Req() req: any,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: SetBankDrawsDto,
  ) {
    return this.banks.setDraws(req.user.id as string, activityId, dto.draws);
  }
}
