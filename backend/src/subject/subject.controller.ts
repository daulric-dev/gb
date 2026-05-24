import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { VersioningService } from '@/versioning/versioning.service';
import { SubjectService } from './subject.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { ReorderSubjectsDto } from './dto/reorder-subjects.dto';

@ApiTags('Subjects')
@ApiBearerAuth()
@Controller('subjects')
@UseGuards(AuthGuard)
export class SubjectController {
  constructor(
    private readonly subjectService: SubjectService,
    private readonly versioning: VersioningService,
  ) {}

  @Get()
  async findAll(@Req() req: any) {
    const raw = await this.subjectService.findAll(req.user.id);
    return this.versioning.resolve(req, 'subject.list')(raw);
  }

  @Patch('reorder')
  async reorder(@Req() req: any, @Body() dto: ReorderSubjectsDto) {
    const raw = await this.subjectService.reorder(req.user.id, dto);
    return this.versioning.resolve(req, 'subject.reordered')(raw);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const raw = await this.subjectService.findOne(req.user.id, id);
    return this.versioning.resolve(req, 'subject.detail')(raw);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateSubjectDto) {
    const raw = await this.subjectService.create(req.user.id, dto);
    return this.versioning.resolve(req, 'subject.created')(raw);
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    const raw = await this.subjectService.update(req.user.id, id, dto);
    return this.versioning.resolve(req, 'subject.updated')(raw);
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    const raw = await this.subjectService.delete(req.user.id, id);
    return this.versioning.resolve(req, 'subject.deleted')(raw);
  }
}
