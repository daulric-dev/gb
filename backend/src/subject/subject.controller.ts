import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { SubjectService } from './subject.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@ApiTags('Subjects')
@ApiBearerAuth()
@Controller('subjects')
@UseGuards(AuthGuard)
export class SubjectController {
  constructor(private readonly subjectService: SubjectService) {}

  @Get()
  findAll(@Req() req) {
    return this.subjectService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subjectService.findOne(id);
  }

  @Post()
  create(@Req() req, @Body() dto: CreateSubjectDto) {
    return this.subjectService.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    return this.subjectService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.subjectService.delete(id);
  }
}
