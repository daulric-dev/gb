import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { VersioningService } from '@/versioning/versioning.service';
import { AssessmentService } from './assessment.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ExcludeDto } from './dto/exclude.dto';

@ApiTags('Assessments')
@ApiBearerAuth()
@Controller('assessments')
@UseGuards(AuthGuard)
export class AssessmentController {
  constructor(
    private readonly assessmentService: AssessmentService,
    private readonly versioning: VersioningService,
  ) {}

  private getToken(req: any): string {
    return req.headers.authorization?.replace('Bearer ', '') ?? '';
  }

  @Get()
  async findByTermAndSubject(
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() req: any,
  ) {
    const raw = await this.assessmentService.findByTermAndSubject(
      termId,
      subjectId,
      this.getToken(req),
    );
    return this.versioning.resolve(req, 'assessment.list')(raw);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const raw = await this.assessmentService.findOne(id, this.getToken(req));
    return this.versioning.resolve(req, 'assessment.detail')(raw);
  }

  @Post()
  async create(@Body() dto: CreateAssessmentDto, @Req() req: any) {
    const raw = await this.assessmentService.create(
      req.user.id,
      dto,
      this.getToken(req),
    );
    return this.versioning.resolve(req, 'assessment.created')(raw);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAssessmentDto,
    @Req() req: any,
  ) {
    const raw = await this.assessmentService.update(
      id,
      dto,
      this.getToken(req),
    );
    return this.versioning.resolve(req, 'assessment.updated')(raw);
  }

  @Patch(':id/exclude')
  async exclude(
    @Param('id') id: string,
    @Body() dto: ExcludeDto,
    @Req() req: any,
  ) {
    const raw = await this.assessmentService.exclude(
      id,
      dto,
      this.getToken(req),
    );
    return this.versioning.resolve(req, 'assessment.excluded')(raw);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    const raw = await this.assessmentService.delete(id, this.getToken(req));
    return this.versioning.resolve(req, 'assessment.deleted')(raw);
  }
}
