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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PastoralService } from './pastoral.service';
import {
  CreatePastoralCategoryDto,
  CreatePastoralNoteDto,
  PastoralNoteQueryDto,
  UpdatePastoralCategoryDto,
  UpdatePastoralNoteDto,
  UpdatePastoralSettingsDto,
} from './pastoral.dto';

/**
 * Behaviour and pastoral notes (`pastoral_notes` feature), staff only. The
 * permission rules (pastoral-note:read/create/update/safeguarding, authors
 * see their own) are applied in PastoralService because they depend on the
 * note; the school is always the caller's active school.
 */
@ApiTags('Pastoral notes')
@ApiBearerAuth()
@Controller('pastoral')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('pastoral_notes')
export class PastoralController {
  constructor(private readonly pastoral: PastoralService) {}

  @Get('me')
  me(@Req() req: any) {
    return this.pastoral.me(req.user.id as string);
  }

  @Get('categories')
  categories(@Req() req: any, @Query('archived') archived?: string) {
    return this.pastoral.categories(req.user.id as string, archived === 'true');
  }

  @Post('categories')
  createCategory(@Req() req: any, @Body() dto: CreatePastoralCategoryDto) {
    return this.pastoral.createCategory(req.user.id as string, dto);
  }

  @Patch('categories/:categoryId')
  updateCategory(
    @Req() req: any,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdatePastoralCategoryDto,
  ) {
    return this.pastoral.updateCategory(req.user.id as string, categoryId, dto);
  }

  @Get('settings')
  settings(@Req() req: any) {
    return this.pastoral.settings(req.user.id as string);
  }

  @Patch('settings')
  updateSettings(@Req() req: any, @Body() dto: UpdatePastoralSettingsDto) {
    return this.pastoral.updateSettings(req.user.id as string, dto);
  }

  @Get('assignees')
  assignees(@Req() req: any, @Query('safeguarding') safeguarding?: string) {
    return this.pastoral.assignees(req.user.id as string, safeguarding === 'true');
  }

  @Get('notes')
  list(@Req() req: any, @Query() q: PastoralNoteQueryDto) {
    return this.pastoral.list(req.user.id as string, q);
  }

  @Get('follow-ups')
  followUps(@Req() req: any) {
    return this.pastoral.myFollowUps(req.user.id as string);
  }

  @Get('export')
  @ApiProduces('text/csv')
  async exportCsv(@Req() req: any, @Query() q: PastoralNoteQueryDto, @Res() reply: FastifyReply) {
    const out = await this.pastoral.exportCsv(req.user.id as string, q);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${out.filename}"`)
      .header('Cache-Control', 'private, no-store')
      .send(out.csv);
  }

  @Get('students/:studentId/notes')
  timeline(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() q: PastoralNoteQueryDto,
  ) {
    return this.pastoral.timeline(req.user.id as string, studentId, q);
  }

  @Post('students/:studentId/notes')
  create(
    @Req() req: any,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CreatePastoralNoteDto,
  ) {
    return this.pastoral.create(req.user.id as string, studentId, dto);
  }

  @Get('notes/:noteId')
  get(@Req() req: any, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.pastoral.get(req.user.id as string, noteId);
  }

  @Patch('notes/:noteId')
  update(
    @Req() req: any,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdatePastoralNoteDto,
  ) {
    return this.pastoral.update(req.user.id as string, noteId, dto);
  }

  @Delete('notes/:noteId')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('noteId', ParseUUIDPipe) noteId: string) {
    await this.pastoral.remove(req.user.id as string, noteId);
  }

  @Get('notes/:noteId/files/:fileId')
  @ApiProduces('application/octet-stream')
  async file(
    @Req() req: any,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() reply: FastifyReply,
  ) {
    const { body, size, contentType, filename } = await this.pastoral.readFile(
      req.user.id as string,
      noteId,
      fileId,
    );
    if (size !== null) reply.header('Content-Length', size);
    return reply
      .header('Content-Type', contentType ?? 'application/octet-stream')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename ?? 'file')}`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .send(body);
  }
}
