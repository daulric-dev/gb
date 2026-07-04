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
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { FileManagerService } from './file-manager.service';
import { ListFilesQueryDto } from './dto/list-files.query.dto';
import { RenameFileDto } from './dto/rename-file.dto';
import { ShareFileDto } from './dto/share-file.dto';
import { UpdateShareDto } from './dto/update-share.dto';

@ApiTags('File Manager')
@ApiBearerAuth()
@Controller('files')
@UseGuards(AuthGuard, PermissionGuard)
export class FileManagerController {
  constructor(private readonly files: FileManagerService) {}

  @RequirePermission('file', 'read')
  @Get()
  async list(@Req() req: any, @Query() query: ListFilesQueryDto) {
    return this.files.list(req.user.id, query.filter);
  }

  @RequirePermission('file', 'create')
  @Post()
  @ApiConsumes('multipart/form-data')
  async upload(@Req() req: any, @Query('name') name?: string) {
    const file = await req.file();
    return this.files.uploadManual(req.user.id, file, name);
  }

  @RequirePermission('file', 'read')
  @Get(':id')
  async metadata(@Req() req: any, @Param('id') id: string) {
    return this.files.getMetadata(req.user.id, id);
  }

  @RequirePermission('file', 'read')
  @Get(':id/content')
  async view(
    @Req() req: any,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, contentType, filename } = await this.files.getViewContent(
      req.user.id,
      id,
    );
    reply
      .header('Content-Type', contentType)
      .header(
        'Content-Disposition',
        `inline; filename="${this.encode(filename)}"`,
      )
      .header('Content-Length', buffer.length)
      .header('Cache-Control', 'private, no-store')
      .send(buffer);
  }

  /** Download — only for the owner or a recipient with download rights. */
  @RequirePermission('file', 'read')
  @Get(':id/download')
  async download(
    @Req() req: any,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, contentType, filename } =
      await this.files.getDownloadContent(req.user.id, id);
    reply
      .header('Content-Type', contentType)
      .header(
        'Content-Disposition',
        `attachment; filename="${this.encode(filename)}"`,
      )
      .header('Content-Length', buffer.length)
      .header('Cache-Control', 'private, no-store')
      .send(buffer);
  }

  @RequirePermission('file', 'update')
  @Patch(':id')
  async rename(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RenameFileDto,
  ) {
    return this.files.rename(req.user.id, id, dto.name);
  }

  @RequirePermission('file', 'delete')
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.files.softDelete(req.user.id, id);
  }

  // ── Shares (owner only; ownership enforced in the service) ─────────────────

  @RequirePermission('file', 'update')
  @Get(':id/shares')
  async listShares(@Req() req: any, @Param('id') id: string) {
    return this.files.listShares(req.user.id, id);
  }

  @RequirePermission('file', 'update')
  @Post(':id/shares')
  async share(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ShareFileDto,
  ) {
    return this.files.share(req.user.id, id, dto.shares);
  }

  @RequirePermission('file', 'update')
  @Patch(':id/shares/:shareId')
  async updateShare(
    @Req() req: any,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdateShareDto,
  ) {
    return this.files.updateShare(req.user.id, id, shareId, dto.canDownload);
  }

  @RequirePermission('file', 'update')
  @Delete(':id/shares/:shareId')
  async revokeShare(
    @Req() req: any,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
  ) {
    return this.files.revokeShare(req.user.id, id, shareId);
  }

  /** RFC 5987-safe filename for the Content-Disposition header. */
  private encode(name: string): string {
    return name.replace(/["\\\r\n]/g, '_');
  }
}
