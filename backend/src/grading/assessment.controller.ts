import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { AssessmentService } from './assessment.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ExcludeDto } from './dto/exclude.dto';

@ApiTags('Assessments')
@ApiBearerAuth()
@Controller('assessments')
@UseGuards(AuthGuard)
export class AssessmentController {
  constructor(private readonly assessmentService: AssessmentService) {}

  private getToken(req: any): string {
    return req.headers.authorization?.replace('Bearer ', '') ?? '';
  }

  @Get()
  findByTermAndSubject(
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() req: any,
  ) {
    return this.assessmentService.findByTermAndSubject(
      termId,
      subjectId,
      this.getToken(req),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.assessmentService.findOne(id, this.getToken(req));
  }

  @Post()
  create(@Body() dto: CreateAssessmentDto, @Req() req: any) {
    return this.assessmentService.create(
      req.user.id,
      dto,
      this.getToken(req),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssessmentDto,
    @Req() req: any,
  ) {
    return this.assessmentService.update(id, dto, this.getToken(req));
  }

  @Patch(':id/exclude')
  exclude(
    @Param('id') id: string,
    @Body() dto: ExcludeDto,
    @Req() req: any,
  ) {
    return this.assessmentService.exclude(id, dto, this.getToken(req));
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.assessmentService.delete(id, this.getToken(req));
  }
}