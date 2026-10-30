import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { CourseFileService } from './course-file.service';

/** A file the course offers, for its staff (see CourseFileService). */
@ApiTags('Course files')
@ApiBearerAuth()
@Controller('courses/:courseId/files')
@UseGuards(AuthGuard)
export class CourseFileController {
  constructor(private readonly files: CourseFileService) {}

  @Get(':fileId')
  @ApiProduces('application/octet-stream')
  async open(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() reply: FastifyReply,
  ) {
    const { body, size, contentType, filename } = await this.files.read(
      req.user.id as string,
      courseId,
      fileId,
    );
    if (size !== null) reply.header('Content-Length', size);
    return reply
      .header('Content-Type', contentType ?? 'application/octet-stream')
      .header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(filename ?? 'file')}`,
      )
      .header('Cache-Control', 'private, no-store')
      // Uploaded content on the API origin: never sniff it into HTML.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .send(body);
  }
}
