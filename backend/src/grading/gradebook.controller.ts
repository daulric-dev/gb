import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { GradebookService } from './gradebook.service';

/** The course gradebook, for every staff role in the course. */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('courses/:courseId/gradebook')
@UseGuards(AuthGuard)
export class GradebookController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get()
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.gradebook.gradebook(req.user.id as string, courseId);
  }

  @Get('export')
  @ApiProduces('text/csv')
  async export(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Res() res: FastifyReply,
  ) {
    const { csv, filename } = await this.gradebook.exportCsv(
      req.user.id as string,
      courseId,
    );

    return res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store')
      .send(csv);
  }
}
