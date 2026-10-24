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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PageService } from './page.service';
import { CreatePageDto, UpdatePageDto } from './dto/content.dto';

/** Course pages. Staff read, teachers and admins write (course role). */
@ApiTags('Course pages')
@ApiBearerAuth()
@Controller('courses/:courseId/pages')
@UseGuards(AuthGuard)
export class PageController {
  constructor(private readonly pages: PageService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.pages.list(req.user.id as string, courseId);
  }

  @Post()
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreatePageDto,
  ) {
    return this.pages.create(req.user.id as string, courseId, dto);
  }

  @Get(':pageId')
  async get(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
  ) {
    return this.pages.get(req.user.id as string, courseId, pageId);
  }

  @Patch(':pageId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pages.update(req.user.id as string, courseId, pageId, dto);
  }

  @Delete(':pageId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
  ) {
    await this.pages.remove(req.user.id as string, courseId, pageId);
  }
}
