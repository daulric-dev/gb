import {
  Body,
  Controller,
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
import { GradeService } from './grade.service';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { BulkGradeDto } from './dto/bulk-grade.dto';
import { ExcludeDto } from './dto/exclude.dto';

@ApiTags('Grades')
@ApiBearerAuth()
@Controller('grades')
@UseGuards(AuthGuard)
export class GradeController {
  constructor(private readonly gradeService: GradeService) {}

  private getToken(req: any): string {
    return req.headers.authorization?.replace('Bearer ', '') ?? '';
  }

  @Get()
  findByAssessment(
    @Query('assessmentId') assessmentId: string,
    @Req() req: any,
  ) {
    return this.gradeService.findByAssessment(assessmentId, this.getToken(req));
  }

  @Get('by-term')
  findByTermAndSubject(
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() req: any,
  ) {
    return this.gradeService.findByTermAndSubject(
      termId,
      subjectId,
      this.getToken(req),
    );
  }

  @Post()
  create(@Body() dto: CreateGradeDto, @Req() req: any) {
    return this.gradeService.create(
      req.user.id,
      dto,
      this.getToken(req),
    );
  }

  @Post('bulk')
  bulkCreate(@Body() dto: BulkGradeDto, @Req() req: any) {
    return this.gradeService.bulkCreate(
      req.user.id,
      dto,
      this.getToken(req),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGradeDto,
    @Req() req: any,
  ) {
    return this.gradeService.update(
      id,
      req.user.id,
      dto,
      this.getToken(req),
    );
  }

  @Patch(':id/exclude')
  exclude(
    @Param('id') id: string,
    @Body() dto: ExcludeDto,
    @Req() req: any,
  ) {
    return this.gradeService.exclude(
      id,
      req.user.id,
      dto,
      this.getToken(req),
    );
  }
}
